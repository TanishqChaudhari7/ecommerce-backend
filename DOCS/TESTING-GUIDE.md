# Testing Guide

## Running tests

All test commands require PostgreSQL and Redis to be reachable (`docker compose up -d` if you haven't already). Kafka is optional for tests — if it isn't running, event publishing fails fast and is logged rather than blocking or slowing down the suite.

```bash
# Run everything (tests/unit + tests/integration)
npm test

# Run only the integration suite
npm run test:integration

# Run a single test file
npx jest tests/integration/orders.test.ts

# Run a single test by name (within one file)
npx jest tests/integration/orders.test.ts -t "cancels an order"
```

You do **not** need to run migrations or seed the database yourself before testing — `tests/setup.ts` does this automatically for every test file:

1. Creates the test database (`ecommerce_test` by default, from `TEST_DATABASE_URL`) if it doesn't already exist.
2. Runs all migrations against it.
3. Truncates every table and reseeds from scratch, so each test file always starts from the exact same known state (the same 3 seeded users, 20 products, etc.) rather than accumulating leftovers from a previous run.
4. Clears any Redis rate-limit keys, so the test file's own logins get a full budget against the login/register rate limiters.

This all happens against a **separate database** from the one your dev server uses (`ecommerce` vs. `ecommerce_test`) — running the test suite never touches your local dev data.

## What the concurrency test proves, and how to read its output

`tests/integration/concurrency.test.ts` is the one automated test that exists specifically to prove a claim about correctness under load, not just "does this endpoint return the right status code."

**The claim:** when a product has `total_stock = 3` and 10 different customers simultaneously try to buy 1 unit each, the system must let exactly 3 succeed and reject the other 7 — never more than 3, never a negative available-stock count. This is the property that makes `POST /orders`'s use of `SELECT ... FOR UPDATE` (row-locking the inventory row before checking/reserving stock) meaningful rather than decorative: without that lock, a naive "check stock, then reserve" implementation can let two concurrent requests both pass the check before either commits its reservation, overselling the product.

**How the test does it:**
1. Creates a fresh product with `total_stock = 3`.
2. Creates 10 disposable customer identities (bypassing the register/login HTTP endpoints and their rate limiters — each needs its own cart, and firing 10 real logins would trip the 5-per-15-minutes login limiter), each adding 1 unit of the product to their own cart.
3. Fires all 10 `POST /orders` requests **simultaneously** via `Promise.all` — no sequencing, no delay between them.
4. After all 10 have settled, asserts: exactly 3 responses are `201`, exactly 7 are non-`201`; and querying the database directly shows `reserved_stock === 3` and `total_stock - reserved_stock === 0` (never negative).

**Reading the output** — the test itself prints a summary line before its assertions run:

```
[concurrency] PASS — succeeded=3 failed=7 reservedStock=3 totalStock=3 availableStock=0
```

- `PASS` / `FAIL` — a quick human-readable verdict (the actual pass/fail of the Jest test is still driven by `expect(...)` assertions below this line; the printed verdict and the assertions should always agree).
- `succeeded` / `failed` — how many of the 10 requests got `201` vs. anything else.
- `reservedStock` — should exactly equal `total_stock` (3) when the product's stock is fully claimed.
- `availableStock` — `total_stock - reserved_stock`; must be `0` here, and must never be negative in any run.

If this test ever reports `succeeded` > 3, or `availableStock` < 0, that means the row lock stopped working (e.g. a refactor accidentally changed `FOR UPDATE` to a plain `SELECT`, or removed the transaction) and the system can oversell — that's a correctness regression serious enough to block a release.

## Running `scripts/test-concurrency.ts` manually

Unlike the Jest test above, this is a standalone CLI script that hits a **real, already-running** server over HTTP (`http://localhost:3000` by default, or `API_BASE_URL` if set) — useful for manually verifying inventory safety against docker-compose, a staging environment, or after making changes you want to sanity-check live.

**Setup — pick any existing product and note its id, or create one:**

```bash
# Log in as the seeded seller and create a product with known stock
SELLER_TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"seller@test.com","password":"Test@1234"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")

PRODUCT_ID=$(curl -s -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" -H "Authorization: Bearer $SELLER_TOKEN" \
  -d '{"name":"Concurrency Demo","price":10,"sku":"DEMO-SKU-1"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['product']['id'])")

curl -s -X PUT "http://localhost:3000/api/v1/inventory/$PRODUCT_ID" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $SELLER_TOKEN" \
  -d '{"totalStock": 3}'
```

**Run the script** (`productId` and `requestCount` are positional args — note the `--` so npm passes them through rather than treating them as npm's own flags):

```bash
npm run test:concurrency -- "$PRODUCT_ID" 10
```

**Expected output** for a product with 3 units of stock and 10 requests:

```
Firing 10 simultaneous order requests for product <productId>
Request #0 — 201 (a1b2c3...)
Request #1 — 201 (d4e5f6...)
Request #2 — 201 (g7h8i9...)
Request #3 — 400 (Insufficient stock for product <productId>)
Request #4 — 400 (Insufficient stock for product <productId>)
Request #5 — 400 (Insufficient stock for product <productId>)
Request #6 — 400 (Insufficient stock for product <productId>)
Request #7 — 400 (Insufficient stock for product <productId>)
Request #8 — 400 (Insufficient stock for product <productId>)
Request #9 — 400 (Insufficient stock for product <productId>)
Final inventory: total_stock=3 reserved_stock=3 availableStock=0
PASS
```

Exactly 3 successes (matching `totalStock`), `availableStock` at exactly `0`, and a final `PASS` line. `FAIL` (printed when `availableStock < 0`) means stock went negative — the same regression signal as the Jest test above, just observed against a live server instead of an in-process one.

## Expected output for a passing full run

```
Test Suites: 10 passed, 10 total
Tests:       54 passed, 54 total
Snapshots:   0 total
Time:        ~12-25s (varies with whether Kafka is reachable)
Ran all test suites.
```
