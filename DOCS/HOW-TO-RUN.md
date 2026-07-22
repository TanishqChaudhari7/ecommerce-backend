# How to Run

## Prerequisites

- **Node.js 20+** (the codebase targets Node 20; `@types/node` is pinned to `^20`)
- **Docker** and **Docker Compose** (for PostgreSQL, Redis, and Kafka — see `docker-compose.yml`)
- npm (ships with Node)

## First-time setup

From a fresh clone, these are the exact commands to get a working local server:

```bash
git clone <this-repo-url>
cd ecommerce-backend

# 1. Install dependencies
npm install

# 2. Copy environment config and adjust if needed (defaults match docker-compose.yml)
cp .env.example .env

# 3. Start PostgreSQL, Redis, and Kafka
docker compose up -d

# 4. Wait for the services to be ready, then run migrations
npm run migrate

# 5. Seed the database with test users, products, and sample orders
npm run seed

# 6. Start the dev server (hot-reloads on file changes)
npm run dev
```

The server listens on `http://localhost:3000` by default (`PORT` in `.env`).

## Verification URLs

Once the server is running, confirm it's healthy:

| URL | What it shows |
|---|---|
| `http://localhost:3000/health` | `{ status, uptime, timestamp }` — basic liveness check |
| `http://localhost:3000/api-docs` | Interactive Swagger UI documenting every endpoint |
| `http://localhost:3000/metrics` | Prometheus-format metrics (HTTP requests, cache hits/misses, Kafka events) |

## npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Starts the dev server with `nodemon` (auto-restarts on changes) |
| `npm run build` | Compiles TypeScript to `dist/` |
| `npm start` | Runs the compiled server from `dist/src/server.js` (production) |
| `npm run lint` | Runs ESLint across the whole project |
| `npm run migrate` | Applies all pending database migrations |
| `npm run migrate:rollback` | Rolls back the most recently applied migration |
| `npm run seed` | Seeds the database (idempotent — safe to re-run) |
| `npm run seed:fresh` | Truncates all tables, then reseeds from scratch |
| `npm test` | Runs the full Jest suite (unit + integration tests) |
| `npm run test:integration` | Runs only `tests/integration/*.test.ts` |
| `npm run test:concurrency` | Runs the standalone concurrency CLI script against a **running** server (see `DOCS/TESTING-GUIDE.md`) |

## End-to-end curl walkthrough

This walks through the full customer journey: register → login → browse products → search → add to cart → place an order → pay → check status. Run each command in order, substituting the values noted in `# →`.

```bash
BASE=http://localhost:3000/api/v1

# 1. Register a new customer
curl -s -X POST $BASE/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"shopper@example.com","password":"Sup3rSecret!","firstName":"Sam","lastName":"Shopper"}'

# 2. Log in — copy the accessToken from the response into $TOKEN below
curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"shopper@example.com","password":"Sup3rSecret!"}'
# → TOKEN="<accessToken from the response above>"

# 3. Browse products (public, paginated)
curl -s "$BASE/products?page=1&limit=5"
# → PRODUCT_ID="<an id from the response above>"

# 4. Full-text search with filters
curl -s "$BASE/search?q=wireless&sortBy=price&sortOrder=asc"

# 5. Add a product to the cart
curl -s -X POST $BASE/cart/items \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}"

# 6. Place an order from the cart
curl -s -X POST $BASE/orders -H "Authorization: Bearer $TOKEN"
# → ORDER_ID="<order.id from the response above>"

# 7. Initiate a payment (paymentKey is any client-generated idempotency key)
curl -s -X POST $BASE/payments/initiate \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"orderId\":\"$ORDER_ID\",\"paymentKey\":\"my-idempotency-key-1\"}"
# → PAYMENT_ID="<payment.id from the response above>"

# 8. Process the payment (mocked: ~90% succeed, ~10% fail with 402 — retry with a new paymentKey on failure)
curl -s -X POST $BASE/payments/process/$PAYMENT_ID -H "Authorization: Bearer $TOKEN"

# 9. Check the order status (should now be "confirmed" if payment succeeded)
curl -s $BASE/orders/$ORDER_ID -H "Authorization: Bearer $TOKEN"
```

Seeded credentials (from `npm run seed`), all with password `Test@1234`:

| Role | Email |
|---|---|
| Admin | `admin@test.com` |
| Seller | `seller@test.com` |
| Customer | `customer@test.com` |

## Common errors and fixes

**"Kafka producer connection error" / `ECONNREFUSED` on port 9092 at startup**
Kafka (via `docker compose up`) takes a few seconds longer to become ready than Postgres/Redis. The app tolerates this — Kafka publishing is best-effort and logs a warning rather than crashing the server — but if you see connection errors immediately after `docker compose up -d`, just wait ~10-15 seconds and retry the failing request; the producer connects lazily on first use and will succeed once the broker is up.

**`EADDRINUSE` / port conflict on 3000, 5432, 6379, or 9092**
Something else on your machine is already using one of the app's ports. Either stop the conflicting process, or change the port in `.env` (`PORT` for the app) — for the Docker-managed services, edit the port mappings in `docker-compose.yml`.

**Migration fails with a connection error**
Confirm `docker compose ps` shows `postgres` as healthy, and that `DATABASE_URL` in `.env` matches the credentials in `docker-compose.yml` (defaults: `ecommerce` / `ecommerce` / db `ecommerce`).

**Migration fails with "relation already exists" or similar**
The migration tracking table (`pgmigrations`) may be out of sync with the actual schema — this usually means the database was modified outside of migrations. For a local dev database, the simplest fix is to drop and recreate it, then re-run `npm run migrate && npm run seed`.

**`npm test` looks like it's hanging or is very slow**
Confirm Redis and PostgreSQL are reachable. If Kafka isn't running, tests still pass (Kafka publishing fails fast and is logged, not blocking) — but if it takes several minutes rather than seconds, something is misconfigured; check `KAFKA_BROKERS` isn't pointing at an unreachable host outside your local network (a genuinely unreachable *host* — as opposed to a reachable host with nothing listening on the port — does not fail fast).
