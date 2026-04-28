# EXPLAINER.md

## 1. The Ledger

### Balance Aggregation Query

```python
# repository.py — compute_balance()
result = LedgerEntry.objects.filter(merchant_id=merchant_id).aggregate(
    credits=Sum(Case(When(entry_type='credit', then='amount_paise'), default=Value(0), output_field=BigIntegerField())),
    holds=Sum(Case(When(entry_type='hold', then='amount_paise'), default=Value(0), output_field=BigIntegerField())),
    debits=Sum(Case(When(entry_type='debit', then='amount_paise'), default=Value(0), output_field=BigIntegerField())),
    releases=Sum(Case(When(entry_type='release', then='amount_paise'), default=Value(0), output_field=BigIntegerField())),
)

available = credits - holds + releases
held      = holds - releases - debits
```

The equivalent SQL emitted by Django:

```sql
SELECT
  SUM(CASE WHEN entry_type = 'credit'  THEN amount_paise ELSE 0 END) AS credits,
  SUM(CASE WHEN entry_type = 'hold'    THEN amount_paise ELSE 0 END) AS holds,
  SUM(CASE WHEN entry_type = 'debit'   THEN amount_paise ELSE 0 END) AS debits,
  SUM(CASE WHEN entry_type = 'release' THEN amount_paise ELSE 0 END) AS releases
FROM payouts_ledgerentry
WHERE merchant_id = %s;
```

### Why append-only?

A stored `balance` column is a derived value — storing it creates two sources of truth that can diverge under concurrent writes or rolled-back transactions. With an append-only ledger, every monetary event is a permanent fact. The balance is always computed from those facts inside the same transaction as any write, so it is always consistent. You also get a full audit trail for free.

Critically, `compute_balance` is always called inside a `transaction.atomic()` block — either the payout creation block (`service.py:70`) or the balance fetch block (`service.py:228`). This means the aggregation query and any subsequent write (hold creation, payout row) share the same database snapshot. A concurrent credit that commits between the SELECT and the INSERT cannot silently inflate the balance the current transaction acts on.

### Why these four entry types?

| Type      | Meaning |
|-----------|---------|
| `credit`  | Funds deposited into the merchant's wallet |
| `hold`    | Funds reserved when a payout is initiated — reduces `available` immediately |
| `debit`   | Funds confirmed sent on payout success — closes the hold (reduces `held` only; `available` was already reduced by the hold) |
| `release` | Hold cancelled on payout failure — moves funds from `held` back to `available` |

`hold` and `release` together implement a two-phase commit for each payout: reserve first, confirm or cancel atomically later. This prevents the window between "check balance" and "deduct balance" from allowing overdrafts.

---

## 2. The Lock

### Exact lines that prevent overdraft under concurrency

```python
# service.py — create_payout()
with transaction.atomic():
    merchant = repository.get_merchant_for_update(merchant_id)  # ← THE LOCK
    balance  = repository.compute_balance(merchant_id)           # ← inside lock

    if amount_paise > balance['available_paise']:
        # Return 400 — no hold created, no overdraft possible
        ...

    payout = repository.create_payout(...)
    repository.create_ledger_entry(..., entry_type='hold', ...)
# COMMIT — lock released here
```

```python
# repository.py — get_merchant_for_update()
def get_merchant_for_update(merchant_id):
    return Merchant.objects.select_for_update().get(id=merchant_id)
```

### What `select_for_update` does at the DB level

`SELECT ... FOR UPDATE` places a row-level exclusive lock on the `Merchant` row for the duration of the transaction. Any second transaction that tries to `SELECT ... FOR UPDATE` the same row will **block** at the database kernel level until the first transaction commits or rolls back.

This serialises all concurrent payout requests for the same merchant: Thread B cannot even read the balance until Thread A has finished its balance check, created the hold entry, and committed. There is therefore no window in which both threads can see the same available balance simultaneously and both decide they have enough funds.

---

## 3. The Idempotency

### The IntegrityError guard

```python
# repository.py — create_idempotency_record_placeholder()
try:
    record, created = IdempotencyRecord.objects.get_or_create(
        merchant_id=merchant_id,
        key=key,
        defaults={'response_json': None, 'status_code': None},
    )
    return record, created
except IntegrityError:
    # Race loser: the unique constraint fired because the winner
    # inserted the row between our SELECT and our INSERT.
    record = IdempotencyRecord.objects.get(merchant_id=merchant_id, key=key)
    return record, False
```

### What happens if two identical requests arrive before either has written the record?

`get_or_create` is **not atomic** — it does a SELECT then an INSERT. Two concurrent requests can both find no existing row on the SELECT, then both attempt to INSERT. The database's `UNIQUE (merchant_id, key)` constraint ensures exactly one INSERT wins; the other raises `IntegrityError`. The loser catches the error, fetches the winner's row (which now exists), and returns it with `created=False`.

Because the placeholder has `response_json=None`, the service detects an in-flight request and returns HTTP 409 rather than duplicating the payout. Once the winner fills in the real response, any subsequent request will find `response_json` populated and return the stored answer directly.

Keys expire after 24 hours. `get_idempotency_record` in `repository.py` filters with `created_at__gt=timezone.now() - timedelta(hours=24)` — a key older than 24 hours returns `None`, and the service treats the request as new. The expiry is enforced at the query layer, not a background cleanup job, so there is no window where an expired key is accidentally honoured.

---

## 4. The State Machine

### Where `failed → completed` (and all other illegal transitions) are blocked

```python
# service.py
VALID_TRANSITIONS = {
    'pending': ['processing'],
    'processing': ['completed', 'failed'],
}

def _apply_transition(payout, new_status):
    allowed = VALID_TRANSITIONS.get(payout.status, [])
    if new_status not in allowed:
        raise InvalidStateTransitionError(
            f"Cannot transition payout {payout.id} from '{payout.status}' to '{new_status}'"
        )
    payout.status = new_status
```

`failed` is not a key in `VALID_TRANSITIONS`, so `VALID_TRANSITIONS.get('failed', [])` returns `[]`. Any attempt to call `_apply_transition(payout, 'completed')` on a failed payout will find `'completed' not in []` and raise. The same applies to `completed → anything` and `pending → completed/failed` (skipping processing).

The model has no `clean()`, no `save()` override, and no DB-level constraint enforcing transitions — the check lives exclusively in the service layer so it can raise a typed exception rather than a cryptic IntegrityError.

When a payout moves to `failed`, the `release` ledger entry and the status update are committed inside the same `transaction.atomic()` block in `_fail_payout()`. Either both commit or neither does — there is no state where a payout is marked `failed` without its funds being returned, or where funds are returned without the status flip.

---

## 5. The AI Audit

### Example: AI suggested storing balance as a column, not aggregating from the ledger

**What AI gave me:**

```python
class Merchant(models.Model):
    available_balance_paise = models.BigIntegerField(default=0)
    held_balance_paise = models.BigIntegerField(default=0)

    def deduct_hold(self, amount):
        self.available_balance_paise -= amount
        self.held_balance_paise += amount
        self.save()
```

**What was wrong:**

This creates a race condition even with `select_for_update` because the balance is now in two tables — the `Merchant` row AND the `LedgerEntry` table. More critically, if a transaction rolls back after updating `available_balance_paise` but before committing, the column update is lost but the ledger entry is not (or vice versa), permanently desynchronising them. There is also no audit trail: you cannot reconstruct the history of individual holds and releases.

**What I replaced it with:**

The balance is never stored. It is always computed via a single SQL aggregation over `LedgerEntry` rows, and that aggregation always runs **inside the same `transaction.atomic()` block** as any balance check or write. The merchant row is locked with `select_for_update()` to serialise concurrent requests, but the balance itself is the result of the ledger — not a column that can drift.

---

### Example: AI generated a flat structure — business logic mixed into views

**What AI gave me:**

```python
# views.py
class PayoutCreateView(APIView):
    def post(self, request):
        merchant = Merchant.objects.select_for_update().get(id=request.data['merchant_id'])
        balance = LedgerEntry.objects.filter(merchant=merchant).aggregate(...)
        if request.data['amount_paise'] > balance['available']:
            return Response({'error': 'Insufficient funds'}, status=400)
        payout = Payout.objects.create(
            merchant=merchant,
            amount_paise=request.data['amount_paise'],
            status='pending',
        )
        LedgerEntry.objects.create(merchant=merchant, entry_type='hold', amount_paise=payout.amount_paise)
        return Response(PayoutSerializer(payout).data, status=201)
```

**What was wrong:**

All database access, balance logic, locking, and state transitions are collapsed into the view. The view now owns HTTP concerns (parsing, response codes) AND business rules (balance check, hold creation) AND data access (ORM queries). This is the "fat view" pattern. Problems:

- Business rules cannot be reused from Celery tasks — the worker would have to import and call the view, or duplicate the logic.
- The idempotency check, state machine, and retry logic have nowhere clean to live — they get bolted onto the view, making it untestable in isolation.
- There is no seam between "what the HTTP layer receives" and "what the money engine does", so a future gRPC or CLI caller would need to replicate all of it.

**What I replaced it with:**

A strict three-layer separation enforced across every endpoint:

```
views.py       → HTTP only: parse input, validate types, call service, return Response
service.py     → Business logic only: transactions, state machine, idempotency, balance checks
repository.py  → Data access only: all ORM queries, no business rules
```

The view for payout creation does nothing except validate the request shape and delegate:

```python
# views.py — HTTP layer only
response_data, http_status = service.create_payout(
    merchant_id=merchant_id,
    amount_paise=amount_paise,
    bank_account_id=bank_account_id,
    idempotency_key=idempotency_key,
)
return Response(response_data, status=http_status)
```

The Celery task calls `service.process_payout(payout_id)` directly — the same function, no duplication. The state machine, lock, and idempotency logic live once in `service.py` and are exercised identically whether the caller is an HTTP request or a background worker.

---

### Example: AI generated an unlocked read-then-write — overdraft under concurrency

**What AI gave me:**

```python
balance = repo.get_balance(merchant_id)
if balance < amount:
    raise Exception("Insufficient balance")
repo.create_payout(...)
repo.insert_ledger_hold(...)
```

**What was wrong:**

Two concurrent requests both read the same balance before either writes. With a 100 paise balance, two 60 paise requests both pass the check and both create holds — leaving the balance at -20. No lock, no atomicity, classic check-then-act race.

**What I replaced it with:**

```python
with transaction.atomic():
    merchant = repository.get_merchant_for_update(merchant_id)  # SELECT ... FOR UPDATE
    balance  = repository.compute_balance(merchant_id)
    if amount_paise > balance['available_paise']:
        return error_response, 400
    repository.create_payout(...)
    repository.create_ledger_entry(..., entry_type='hold', ...)
```

`select_for_update()` locks the `Merchant` row for the transaction's duration. A second concurrent request blocks at the DB kernel until the first commits. The balance read, check, and hold creation are all inside the same atomic block — no window for a stale read.
