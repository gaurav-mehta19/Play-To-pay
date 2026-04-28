# Play To Pay — Payout Engine

Merchant payout engine with balance ledger, idempotent payout requests, async bank settlement simulation, and a live-updating React dashboard.

**Stack:** Django 4.2 · DRF · PostgreSQL (Neon) · Celery · Redis (Upstash) · Next.js 14 · Tailwind CSS

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

## Quick start — Docker

Requires Docker, Docker Compose, and Node.js. Uses local containerised Postgres + Redis — no cloud credentials needed.

```bash
git clone <repo-url>
cd play-to-pay
docker compose up --build      # first boot — builds images, runs migrations, seeds data
docker compose up              # subsequent boots
```

Services:

| Service  | URL                               |
| -------- | --------------------------------- |
| Frontend | <http://localhost:3000>           |
| Backend  | <http://localhost:8000>           |
| API base | <http://localhost:8000/api/v1/>   |

On first boot the `web` container runs `migrate` + `seed_merchants` automatically.

---

## Quick start — local (no Docker)

Requires Python 3.11+, Node.js 18+, and cloud accounts on [Neon](https://neon.tech) (Postgres) and [Upstash](https://upstash.com) (Redis).

### 1. Configure environment

Copy the example files and fill in your credentials:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

**`backend/.env`** — get values from your Neon project dashboard and Upstash Redis dashboard:

```env
SECRET_KEY=your-secret-key-here
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1
DJANGO_SETTINGS_MODULE=config.settings

DB_HOST=<neon-host>
DB_NAME=<neon-db-name>
DB_USER=<neon-user>
DB_PASSWORD=<neon-password>
DB_PORT=5432

REDIS_URL=rediss://<upstash-url>   # note: rediss:// with double-s for TLS

CORS_ALLOWED_ORIGINS=http://localhost:3000
CORS_ALLOW_ALL=True
```

**`frontend/.env`** — points Next.js at the local Django server:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 2. Install dependencies

```bash
npm run install     # creates backend/.venv, pip install, frontend npm install
```

### 3. Set up the database

```bash
npm run migrate     # apply Django migrations against Neon
npm run seed        # seed demo merchants (prompts before overwriting existing data)
```

### 4. Start services

```bash
# Start backend (Django + Celery worker + Celery beat) in one terminal
npm run backend

# Start frontend in another terminal
npm run frontend
```

| Service  | URL                         |
| -------- | --------------------------- |
| Frontend | <http://localhost:3000>     |
| Backend  | <http://localhost:8000>     |

---

## npm scripts

| Command | What it does |
| ------- | ------------ |
| `npm run install` | Create `backend/.venv`, pip install, frontend npm install |
| `npm run migrate` | Apply Django migrations |
| `npm run seed` | Seed demo merchants — prompts if data already exists |
| `npm run backend` | Start Django server + Celery worker + Celery beat (concurrently) |
| `npm run frontend` | Start Next.js dev server |
| `npm run test` | Run both test suites |

---

## Running tests

### Without Docker

```bash
npm run test
```

Requires `backend/.env` to be configured (runs against your Neon database). Creates and drops a temporary test database automatically.

### With Docker

```bash
docker compose run --rm web python manage.py test tests.test_concurrency tests.test_idempotency
```

Runs against the containerised Postgres — no `.env` needed.

### What the tests cover

| Suite | What it tests |
| ----- | ------------- |
| `test_concurrency` | Two simultaneous 8000-paise requests against a 10000-paise balance — exactly one must succeed, one must fail, no overdraft |
| `test_idempotency` | Same `Idempotency-Key` sent twice — byte-identical responses, one payout row, one hold entry |

---

## Seed data

On Docker boot, seed runs automatically. Locally, run it manually:

```bash
npm run seed
```

If merchants already exist you will be prompted:

```text
Data already exists. Delete all merchants, payouts, and ledger entries and re-seed? [y/N]
```

| Merchant    | Initial credit |
| ----------- | -------------- |
| Acme Corp   | ₹10,000        |
| Globex Inc  | ₹5,000         |
| Initech Ltd | ₹25,000        |

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

Sending the same `Idempotency-Key` again returns the identical response. Keys are scoped per merchant.

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

| Status | Meaning |
| ------ | ------- |
| `pending` | Created, funds held |
| `processing` | Picked up by Celery worker, bank call in progress |
| `completed` | Bank confirmed — `debit` ledger entry written |
| `failed` | Bank rejected or max retries exceeded — `release` entry written, funds returned |

Bank simulation: 70% success · 20% failure · 10% hang (handled by stuck-payout detector).

Stuck detector runs every 15 seconds. Payouts stuck in `processing` for > 30 seconds are retried up to 3 times, then marked `failed` with funds released atomically.

---

## Balance model

Balance is never stored as a column — always computed via SQL aggregation over the append-only `LedgerEntry` table:

```sql
available = SUM(credit) - SUM(hold) + SUM(release)
held      = SUM(hold)   - SUM(release) - SUM(debit)
```

| Entry type | When written                                         |
| ---------- | ---------------------------------------------------- |
| `credit`   | Funds deposited                                      |
| `hold`     | Payout initiated — reduces available immediately     |
| `debit`    | Payout completed — finalises the hold                |
| `release`  | Payout failed — cancels the hold, restores available |

---

## Project structure

```text
play-to-pay/
├── backend/
│   ├── config/              # Django settings, Celery config, URLs, test runner
│   ├── payouts/
│   │   ├── models.py        # Merchant, LedgerEntry, Payout, IdempotencyRecord
│   │   ├── repository.py    # All DB operations
│   │   ├── service.py       # Business logic, state machine, concurrency
│   │   ├── serializers.py   # DRF serializers (INR display computed here)
│   │   ├── views.py         # Request validation + response formatting only
│   │   ├── tasks.py         # Celery tasks (delegate to service)
│   │   └── management/commands/seed_merchants.py
│   ├── tests/
│   │   ├── test_concurrency.py
│   │   └── test_idempotency.py
│   ├── .env                 # Local credentials — not committed (copy from .env.example)
│   └── .env.example         # Template — committed, safe to share
├── frontend/
│   ├── app/                 # Next.js App Router pages
│   ├── components/          # UI components
│   ├── hooks/               # useBalance, usePayouts, usePolling
│   ├── lib/                 # api.ts, utils.ts
│   ├── .env                 # Local env vars — not committed (copy from .env.example)
│   └── .env.example         # Template — committed, safe to share
├── docker-compose.yml       # Docker dev — zero config, local Postgres + Redis
├── package.json             # npm scripts
└── EXPLAINER.md             # Architecture decisions
```
