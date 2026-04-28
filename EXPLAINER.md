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
