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

---

### Example: `on_commit` callback turning a successful payout into a 500

**What AI gave me:**

```python
def _enqueue_process_payout(payout_id):
    from .tasks import process_payout
    process_payout.delay(str(payout_id))
```

Called as:

```python
transaction.on_commit(lambda: _enqueue_process_payout(payout.id))
```

**What was wrong:**

`on_commit` callbacks run synchronously as part of Django's transaction commit machinery — they are not fire-and-forget. If the Celery broker (Redis) is unavailable when the callback fires, `process_payout.delay()` raises an exception. That exception propagates back up through Django's commit path and converts what was a perfectly successful payout creation (DB write committed, hold created, idempotency record written) into an HTTP 500. The client never sees the 201. If the client retries with the same idempotency key, the payout now exists in the DB with status `pending` but the client was told it failed — the idempotency record holds the 201 response, so the retry returns 201, but the client's trust in the API is already broken.

**What I replaced it with:**

```python
def _enqueue_process_payout(payout_id):
    try:
        from .tasks import process_payout
        process_payout.delay(str(payout_id))
    except Exception:
        # Broker unavailable — stuck-payout detector will re-enqueue pending payouts.
        logger.warning("Could not enqueue payout %s; stuck-payout detector will retry", payout_id)
```

The payout is already safely committed to the DB as `pending`. If the broker is down, the stuck-payout detector fires every 15 seconds, finds the `pending` payout that has never been attempted, and re-enqueues it. The HTTP response is always correct.

---

### Example: Celery silently crashing on TLS Redis (`rediss://`) without SSL options

**What AI gave me:**

```python
REDIS_URL = os.environ.get('REDIS_URL', 'redis://redis:6379/0')
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
```

**What was wrong:**

Celery's Redis transport requires an explicit `ssl_cert_reqs` option when the scheme is `rediss://` (TLS). Without it, the worker raises `ValueError` on startup before processing a single task:

```
ValueError:
A rediss:// URL must have parameter ssl_cert_reqs and this must be set to
CERT_REQUIRED, CERT_OPTIONAL, or CERT_NONE
```

The worker exits immediately. Beat keeps running and scheduling tasks — but the tasks are never consumed. Payouts pile up in `pending` forever and the stuck-payout detector can't help because the worker isn't alive to run it.

**What I replaced it with:**

```python
if REDIS_URL.startswith('rediss://'):
    _ssl = {'ssl_cert_reqs': None}  # ssl.CERT_NONE — Upstash uses valid certs; skip local verification
    CELERY_BROKER_USE_SSL = _ssl
    CELERY_REDIS_BACKEND_USE_SSL = _ssl
```

`ssl_cert_reqs=None` tells Python's SSL layer not to verify the server certificate. Upstash's certificates are valid — this is not a security weakness in practice — but Celery requires the option to be present explicitly rather than inferring a default.

---

### Example: `output: 'standalone'` in Next.js config breaking Vercel deployment

**What AI gave me:**

```js
// next.config.mjs
const nextConfig = {
  output: 'standalone',
}
```

**What was wrong:**

`output: 'standalone'` tells Next.js to bundle the app with its own Node.js server at `.next/standalone/server.js` — intended for self-hosted Docker deployments where you run `node .next/standalone/server.js` directly. Vercel does not use this output. It builds Next.js natively using its own runtime. When Vercel encounters a `standalone` build, `next start` fails:

```
⚠ "next start" does not work with "output: standalone" configuration.
  Use "node .next/standalone/server.js" instead.
```

The server starts (Vercel overrides the start command) but environment variables injected at build time — specifically `NEXT_PUBLIC_API_URL` — are baked into the standalone bundle from build, not from Vercel's environment. The frontend pointed at `http://localhost:8000` in production.

**What I replaced it with:**

```js
const nextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  },
}
```

`output: 'standalone'` removed entirely. Vercel reads `NEXT_PUBLIC_API_URL` from its environment dashboard at build time and inlines it correctly.
