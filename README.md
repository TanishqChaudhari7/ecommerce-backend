# E-Commerce Backend

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat&logo=redis&logoColor=white)
![Kafka](https://img.shields.io/badge/Kafka-231F20?style=flat&logo=apachekafka&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=flat&logo=jest&logoColor=white)

A backend for an online store: catalog, search, carts, checkout and payments, built
around one hard guarantee. **Stock is never oversold, and a checkout or payment is
never applied twice, however many requests arrive at once.** PostgreSQL is the source
of truth, Redis caches reads and enforces rate limits, and Kafka carries domain events.

## Features

- **Auth and roles.** JWT access tokens, rotating single-use refresh tokens, and `customer` / `seller` / `admin` permissions with per-resource ownership checks.
- **Catalog and search.** Product CRUD with soft delete; PostgreSQL full-text search (`tsvector` + GIN index) with category, price and brand filters, sorting and pagination.
- **Caching.** Cache-aside in Redis for product lookups and search pages, invalidated on every write that changes them.
- **Safe checkout.** One transaction reserves stock under row locks taken in a fixed order: no overselling, no deadlocks, and no duplicate order from a double submit.
- **Idempotent payments.** A client-chosen payment key makes retries safe; the order lock ensures one order is never charged twice.
- **Order lifecycle.** `pending → confirmed → shipped → delivered`, with cancellation and refunds that return reserved stock.
- **Events.** Kafka topics for product, inventory, order and payment changes, plus an audit consumer and an idempotent inventory consumer.
- **Operations.** Request ids on every log line, Prometheus metrics, Swagger docs, a sliding-window login rate limiter, and CI running lint, tests, type-check and a Docker build.
- **Evidence.** 54 integration tests, including repeated race tests, and a benchmark suite with recorded results.

## Architecture

```
   client ──HTTP/JSON──▶ Express app
                         requestId ▸ helmet ▸ cors ▸ json ▸ access log ▸ metrics
                               │
                               ▼  /api/v1/<module>
                         route: authenticate ▸ requireRole ▸ validate (zod) ▸ controller
                               │
                               ▼
                         service: business rules, transactions, cache, events
                  ┌────────────┼──────────────────────┐
                  ▼            ▼                      ▼
             PostgreSQL      Redis                  Kafka ──▶ consumers
             source of       product + search       events    audit log,
             truth           cache, rate limits               stock release
```

Seven modules (`auth`, `products`, `search`, `inventory`, `cart`, `orders`, `payments`),
each split into routes, controller (HTTP only), service (SQL and rules), zod validation
and types. The full design is in [DOCS/ARCHITECTURE.md](DOCS/ARCHITECTURE.md).

## Build and run

Requires Node.js 20+ and Docker.

```bash
git clone https://github.com/TanishqChaudhari7/ecommerce-backend.git
cd ecommerce-backend
npm install
cp .env.example .env         # defaults match docker-compose.yml
docker compose up -d         # PostgreSQL, Redis, Kafka
npm run migrate
npm run seed                 # admin@test.com, seller@test.com, customer@test.com / Test@1234
```

Development server, with reload:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

The API is on `http://localhost:3000`: Swagger UI at `/api-docs`, health at `/health`,
Prometheus metrics at `/metrics`.

## Example

A customer's checkout, with responses trimmed to the interesting fields (uses `jq`):

```bash
BASE=http://localhost:3000/api/v1

curl -s -X POST $BASE/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"Sup3rSecret!","firstName":"Demo","lastName":"User"}'
# {"email":"demo@example.com","role":"customer"}

TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"Sup3rSecret!"}' | jq -r .accessToken)

curl -s "$BASE/search?q=wireless&sortBy=price&sortOrder=asc"
# {"products":[{"name":"Wireless Mouse","price":24.99,"availableStock":10}],"total":1}

curl -s -X POST $BASE/cart/items -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d "{\"productId\":\"$PRODUCT_ID\",\"quantity\":2}"
# {"items":[{"productName":"Wireless Mouse","quantity":2,"subtotal":49.98}],"total":49.98}

curl -s -X POST $BASE/orders -H "Authorization: Bearer $TOKEN"
# {"status":"pending","totalAmount":49.98,"paymentStatus":null}

curl -s -X POST $BASE/orders -H "Authorization: Bearer $TOKEN"          # double submit
# 400 {"message":"Cart is empty"}

curl -s -X POST $BASE/payments/initiate -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d "{\"orderId\":\"$ORDER_ID\",\"paymentKey\":\"$KEY\"}"
# 201 {"status":"pending","amount":49.98}       the same request again returns 200, same payment

curl -s -X POST $BASE/payments/process/$PAYMENT_ID -H "Authorization: Bearer $TOKEN"
# {"status":"completed"}        payment is simulated: 10% of attempts fail with 402

curl -s $BASE/orders/$ORDER_ID -H "Authorization: Bearer $TOKEN"
# {"status":"confirmed","paymentStatus":"completed"}
```

`PRODUCT_ID`, `ORDER_ID` and `PAYMENT_ID` come from the previous responses; `KEY` is
any unique string, such as a UUID. [DOCS/HOW-TO-RUN.md](DOCS/HOW-TO-RUN.md) has the
full walkthrough.

## Tests

```bash
npm test                                                   # all 54 tests
npx jest tests/integration/orders.test.ts -t "double-submitted"   # one test
```

Tests run against a separate `ecommerce_test` database that `tests/setup.ts` creates,
migrates and reseeds for each file. Postgres and Redis are required; Kafka is optional.
See [DOCS/TESTING-GUIDE.md](DOCS/TESTING-GUIDE.md).

## Benchmarks

```bash
npm run bench     # builds, starts a production server, writes scripts/bench/results/
```

Measured on an Apple M2 Pro (12 cores, 16 GB), macOS 26.5.2, Node 25.8.2,
PostgreSQL 16.14, Redis 8.6.2, all on one machine over loopback. Timings are medians
of three runs. Raw output is in [scripts/bench/results/](scripts/bench/results/).

| Measurement                                                    | Result                                                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /products/:id`, one at a time                             | 0.24 ms from cache, 0.56 ms from Postgres (mean)                                                   |
| `GET /products/:id`, 50 in flight                              | 16,922 req/s from cache, 10,181 from Postgres                                                      |
| Checkout, 32 in flight, orders on different products           | 1,719.5 orders/s                                                                                   |
| Checkout, 32 in flight, every order on one product             | 1,360.4 orders/s                                                                                   |
| 200 buyers, 64 at once, for 50 units                           | 50 confirmed, 150 refused, 0 oversold, 0 errors                                                    |
| 200 five-item carts locking shared products in opposite orders | 200 succeeded, 0 deadlocks                                                                         |
| One customer submitting checkout twice at once, 10 trials      | one order every time                                                                               |
| Checkout with 50,000 unrelated keys in Redis                   | no slowdown; before search invalidation moved from `SCAN` to a version counter, it was 4–6× slower |

## Design tradeoffs

- **Reserved stock, not decremented stock.** Checkout increments `reserved_stock`; `total_stock` drops only on delivery. Cancellation and refunds are exact inverses, at the cost of a second counter and stock held by unpaid orders.
- **Pessimistic locking under `READ COMMITTED`.** `SELECT … FOR UPDATE` on the cart and inventory rows makes overselling impossible and gives the loser a clean `400`; orders for one hot product run one at a time through its row lock.
- **One lock order everywhere.** Inventory rows sorted by product id, the order row before the payment row, so concurrent checkouts, cancellations and refunds cannot deadlock.
- **Cache-aside with versioned search keys.** Product keys are deleted on write; all search pages are dropped by incrementing one version counter. Writes never scan Redis, and a search page is briefly cold after any product change.
- **Best-effort side effects after commit.** Cache invalidation and Kafka events never fail a committed write. Events can be lost in a crash or broker outage; there is no outbox.
- **Stateless access tokens, stateful refresh tokens.** No database read per request; revoking access takes up to the 15-minute token lifetime.

## Documentation

| Document                                       | Contents                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [DOCS/ARCHITECTURE.md](DOCS/ARCHITECTURE.md)   | Full design: data model, concurrency, caching, events, benchmark method and results, failure modes |
| [DOCS/HOW-TO-RUN.md](DOCS/HOW-TO-RUN.md)       | Setup, scripts, end-to-end curl walkthrough, common errors                                         |
| [DOCS/TESTING-GUIDE.md](DOCS/TESTING-GUIDE.md) | Test layout and what the concurrency tests prove                                                   |
| [DOCS/CHANGELOG.md](DOCS/CHANGELOG.md)         | What changed at each step                                                                          |
