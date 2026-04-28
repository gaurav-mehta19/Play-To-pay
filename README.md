# Playto Payout Engine

Merchant payout engine with balance ledger, idempotent payout requests, async bank settlement simulation, and a live-updating React dashboard.

**Stack:** Django 4.2 · DRF · PostgreSQL · Celery · Redis · Next.js 14 · Tailwind CSS

---

## Architecture

```text
urls → views → service → repository → database
pages → components → hooks → api layer → backend
```

- **Views** — request validation and response formatting only
- **Service** — all business logic, state machine, idempotency, concurrency
- **Repository** — all database operations, no business logic
- **Worker** — reuses service and repository, no duplicate logic

---

## Quick start

Requires Docker and Docker Compose. No `.env` needed.

```bash
git clone <repo-url>
cd playToPay
docker compose up --build
```

Services start in order:

| Service            | URL                             |
| ------------------ | ------------------------------- |
| Frontend (Next.js) | <http://localhost:3000>         |
| Backend (Django)   | <http://localhost:8000>         |
| API base           | <http://localhost:8000/api/v1/> |

On first boot `web` runs `migrate` + `seed_merchants` automatically. Three merchants are created with initial credit balances.

---

## API reference

### Merchants

```http
GET  /api/v1/merchants/
GET  /api/v1/merchants/{id}/balance/
GET  /api/v1/merchants/{id}/ledger/       # paginated, 10 per page
GET  /api/v1/merchants/{id}/payouts/      # paginated, newest first
```

### Payouts

```http
POST /api/v1/payouts/
GET  /api/v1/payouts/{id}/
```

### POST /api/v1/payouts/

Headers:

```http
Idempotency-Key: <uuid-v4>
Content-Type: application/json
```

Body:

```json
{
  "merchant_id": "uuid",
  "amount_paise": 50000,
  "bank_account_id": "bank_hdfc_001"
}
```

Response `201`:

```json
{
  "id": "uuid",
  "amount_paise": 50000,
  "amount_inr": "500.00",
  "status": "pending",
  "created_at": "2026-04-27T10:00:00Z",
  "updated_at": "2026-04-27T10:00:00Z"
}
```

Sending the same `Idempotency-Key` again returns the identical response. Keys are scoped per merchant and expire after 24 hours.

Balance response:

```json
{
  "available_paise": 150000,
  "held_paise": 50000,
  "available_inr": "1500.00",
  "held_inr": "500.00"
}
```

---

## Payout lifecycle

```text
pending → processing → completed
                    ↘ failed
```

- **pending** — created, funds held
- **processing** — picked up by Celery worker, bank call in progress
- **completed** — bank confirmed, `debit` ledger entry written
- **failed** — bank rejected or max retries exceeded, `release` ledger entry written, funds returned

Bank simulation: 70% success · 20% failure · 10% hang (handled by stuck-payout detector).

Stuck detector runs every 15 seconds. Payouts in `processing` for > 30 seconds are retried up to 3 times, then marked `failed` with funds released atomically.

---

## Balance model

Balance is never stored as a column. Always computed via SQL aggregation over the append-only `LedgerEntry` table:

```sql
available = SUM(credit) - SUM(hold) + SUM(release)
held      = SUM(hold)   - SUM(release) - SUM(debit)
```

Four entry types:

| Type      | When written                                        |
| --------- | --------------------------------------------------- |
| `credit`  | Funds deposited (seeded / customer payment)         |
| `hold`    | Payout initiated — reduces available immediately    |
| `debit`   | Payout completed — finalises the hold               |
| `release` | Payout failed — cancels the hold, restores available |

---

## Running tests

```bash
docker compose run --rm web python manage.py test tests.test_concurrency tests.test_idempotency
```

- **test_concurrency** — two simultaneous 8000-paise requests against a 10000-paise balance; asserts exactly one succeeds, one fails, no overdraft
- **test_idempotency** — same `Idempotency-Key` sent twice; asserts byte-identical responses, one payout row, one hold entry

---

## Seed data

The seed command runs automatically on first boot. To run manually:

```bash
docker compose run --rm web python manage.py seed_merchants
```

Creates:

| Merchant    | Initial credit |
| ----------- | -------------- |
| Acme Corp   | ₹10,000        |
| Globex Inc  | ₹5,000         |
| Initech Ltd | ₹25,000        |

---

## Project structure

```text
playToPay/
├── backend/
│   ├── config/              # Django settings, Celery, URLs
│   ├── payouts/
│   │   ├── models.py        # Merchant, LedgerEntry, Payout, IdempotencyRecord
│   │   ├── repository.py    # All DB operations
│   │   ├── service.py       # Business logic, state machine, concurrency
│   │   ├── serializers.py   # DRF serializers (INR display computed here)
│   │   ├── views.py         # Request validation + response only
│   │   ├── tasks.py         # Celery tasks (delegate to service)
│   │   └── management/commands/seed_merchants.py
│   └── tests/
│       ├── test_concurrency.py
│       └── test_idempotency.py
├── frontend/
│   ├── app/                 # Next.js App Router pages
│   ├── components/          # Pure UI components
│   ├── hooks/               # useBalance, usePayouts, usePolling
│   └── lib/                 # api.ts (all fetch calls), utils.ts
├── docker-compose.yml       # Local dev — zero config
├── .env.example             # Template for production .env
└── EXPLAINER.md             # Architecture decisions
```
