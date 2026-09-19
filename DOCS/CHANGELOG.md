# Changelog

## [Released] - 2026-07-22

## [Step 1] - Scaffold & Infrastructure

- Initialized Node.js + TypeScript + Express project with strict-mode `tsconfig.json`.
- Created module folder structure under `src/modules/` for `auth`, `products`, `cart`, `orders`, `payments`, `inventory`, `search`, each with `controller`, `service`, `routes`, and `types` files (placeholder implementations returning `501 Not Implemented`).
- Added root-level `config/`, `migrations/`, `seeds/`, `scripts/`, `tests/` folders.
- Added ESLint (`@typescript-eslint`, flat-style `.eslintrc.cjs` on ESLint 8) + Prettier config, with a dedicated `tsconfig.eslint.json` so linting can type-check `scripts/` and `tests/` without pulling them into the production build.
- Added `nodemon.json` + `ts-node` for hot-reloading dev server.
- Added `dotenv`-based environment loader (`config/env.ts`) and a fully-commented `.env.example`.
- Added `docker-compose.yml` with PostgreSQL (5432), Redis (6379), and Kafka + Zookeeper (9092), plus a multi-stage `Dockerfile` and `.dockerignore` for the Node app.
- Built base Express app (`src/app.ts`) and entrypoint (`src/server.ts`) with:
  - Global error handler middleware (`src/middleware/errorHandler.ts`)
  - Request logging middleware (`src/middleware/requestLogger.ts`)
  - `GET /health` endpoint returning `status`, `uptime`, `timestamp`
  - Winston structured logger (`config/logger.ts`) — JSON in production, colorized pretty-print in development
- Added npm scripts: `dev`, `build`, `start`, `lint`, `migrate`, `migrate:rollback`, `seed`, `seed:fresh`, `test`, `test:integration`, `test:concurrency`. The migrate/seed scripts are placeholders pending Step 2 (Database & Seed).
- Added `jest` + `ts-jest` + `supertest` with a unit test covering the `/health` endpoint; `test:integration` and `test:concurrency` are wired up with `--passWithNoTests` until Step 6 adds real suites.

## [Step 2] - Database & Seed

- Added `pg`, `node-pg-migrate`, and `bcrypt` (+ types) as dependencies.
- Switched `tsconfig.json` to `module`/`moduleResolution: "NodeNext"` (from classic `"node"`) so TypeScript can resolve `node-pg-migrate`'s `exports`-map package, and enabled `isolatedModules: true` (required by ts-jest under `NodeNext`). Extended `tsconfig.eslint.json`'s `include` to also cover `migrations/` and `seeds/`.
- Added `src/config/db.ts`: a shared `pg.Pool` reading `DATABASE_URL` from `config/env.ts`, logging idle-client errors through the existing Winston logger.
- Added 10 `node-pg-migrate` TypeScript migrations (`migrations/*.ts`), run in order: `users`, `sessions`, `categories`, `products`, `inventory`, `shopping_carts`, `cart_items`, `orders`, `order_items`, `payments`.
  - `user_role`, `order_status`, and `payment_status` Postgres ENUM types.
  - `pgcrypto` extension enabled for `gen_random_uuid()` primary keys.
  - Foreign keys with explicit `ON DELETE` semantics (`CASCADE`/`RESTRICT`/`SET NULL`) chosen per relationship — see ARCHITECTURE.md.
  - `products.search_vector` (`tsvector`) column plus a `products_search_vector_update()` trigger function that runs `BEFORE INSERT OR UPDATE` to keep it in sync with `name` + `brand` + `description`.
  - Indexes: `products.seller_id`, `products.category_id`, GIN index on `products.search_vector`, `orders.user_id`, `orders.status`. (`users.email`, `sessions.refresh_token`, `payments.payment_key` are covered by their own `UNIQUE` constraints, which Postgres already backs with an index — no separate index added.)
  - Every migration has a working `down()` — verified with `npm run migrate:rollback`.
- Wired `scripts/migrate.ts` / `scripts/migrate-rollback.ts` to node-pg-migrate's `runner()` API (`direction: 'up'` / `direction: 'down', count: 1`), logging through Winston.
- Added `seeds/seed.ts` — idempotent (`INSERT ... ON CONFLICT DO NOTHING` on each table's natural unique key), seeding:
  - 3 users (`admin@test.com`, `seller@test.com`, `customer@test.com`), all with the same bcrypt hash of `Test@1234`.
  - 5 categories, 20 products (4 per category) owned by the seller.
  - 1 inventory row per product (`total_stock` 10-100, `low_stock_threshold` 10).
  - 1 cart for the customer with 2 cart items.
  - 5 orders for the customer, one in each status (`pending`, `confirmed`, `shipped`, `delivered`, `cancelled`), each with 1 order item.
  - 3 `completed` payments, one each for the `confirmed`/`shipped`/`delivered` orders.
  - All seeded rows use deterministic (hardcoded) UUIDs so reruns are true no-ops rather than relying on `gen_random_uuid()`.
- Wired `scripts/seed.ts` to run the seed directly; `scripts/seed-fresh.ts` runs `TRUNCATE ... RESTART IDENTITY CASCADE` across all 10 tables first, then reseeds.
- Verified end-to-end against a real local PostgreSQL 16 instance: migrate → seed → seed (no-op re-run) → seed:fresh → migrate:rollback → migrate, plus a full drop/recreate database run from scratch.

## [Step 3] - Auth & RBAC

- Added dependencies: `jsonwebtoken`, `zod`, `helmet`, `cors`, `ioredis`, `ms`, `swagger-jsdoc`, `swagger-ui-express` (+ types).
- Added `src/utils/AppError.ts` — a minimal `Error` subclass carrying a `statusCode`, used by services and middleware to drive the existing global `errorHandler`.
- Added `src/config/redis.ts` — a shared `ioredis` client reading `REDIS_URL` from `config/env.ts`.
- Added `src/types/express.d.ts` — global augmentation adding a typed `req.user?: AccessTokenPayload` to Express's `Request`.
- Rebuilt the `auth` module (replacing the Step 1 placeholder):
  - `POST /api/v1/auth/register` — bcrypt-hashes the password (12 rounds), inserts the user with the role from the request body (defaulting to `customer`), returns the created user with `password_hash` excluded. Returns `409` on duplicate email.
  - `POST /api/v1/auth/login` — verifies credentials, issues a 15-minute JWT access token (`{ userId, email, role }`) and a 7-day opaque refresh token, storing the refresh token + `expires_at` in the `sessions` table.
  - `POST /api/v1/auth/refresh` — looks up the refresh token in `sessions`, checks `expires_at`, deletes the old session, and issues a brand new access/refresh pair (rotation).
  - `POST /api/v1/auth/logout` — deletes the session row matching the given refresh token.
  - `GET /api/v1/auth/me` — protected by `authenticateToken`, returns the current user freshly read from the database.
- Added `src/middleware/authenticateToken.ts` — verifies the `Authorization: Bearer <token>` JWT and attaches the payload to `req.user`; responds `401` on missing/invalid/expired tokens.
- Added `src/middleware/requireRole.ts` — `requireRole(...roles)` factory; responds `403` if `req.user` is missing or its role isn't in the allowed list. Verified directly against mock requests (allow/deny for each role combination).
- Added `src/middleware/rateLimiter.ts` — Redis sorted-set sliding-window limiter (`ZREMRANGEBYSCORE` prune → `ZCARD` check → `ZADD` record), returning `429` with a `Retry-After` header (seconds until the oldest entry ages out of the window) when exceeded. Applied to `/register` (10/hour/IP) and `/login` (5/15min/IP).
- Added `src/middleware/validate.ts` — generic `validateBody(schema)` middleware running any Zod schema against `req.body`, returning `400` with flattened field errors on failure.
- Added `src/modules/auth/auth.validation.ts` — Zod schemas for register/login/refresh/logout bodies.
- Added `helmet()` and `cors()` globally in `src/app.ts` (mounted before body parsing/routes).
- Added Swagger documentation: `src/config/swagger.ts` builds an OpenAPI 3.0 spec via `swagger-jsdoc` from `@openapi` JSDoc blocks on each route (glob picks `.ts` in dev / `.js` in the compiled build automatically); mounted at `GET /api-docs` via `swagger-ui-express`. All 5 auth endpoints documented.
- Added `tests/setup.ts` (wired via `jest.config.js`'s `setupFilesAfterEnv`) to close the shared `pg.Pool` and `ioredis` connections after each test file, so `npm test` exits cleanly instead of leaving open handles.
- Verified end-to-end against the running local PostgreSQL + Redis instances: register (incl. duplicate-email 409 and Zod validation 400), login, `/me` with valid/missing/garbage tokens, refresh rotation (old token rejected after use), logout (token rejected after logout), wrong-password 401, login rate limit tripping at the 6th request in 15 minutes with a correct `Retry-After`, register rate limit tripping at the 11th request in an hour, and the Swagger UI/spec serving all 5 documented paths.

## [Step 4] - Products, Inventory & Search

- Added `kafkajs` as a dependency.
- Added `src/config/kafka.ts` — a lazily-connected `kafkajs` producer (`Partitioners.DefaultPartitioner` set explicitly) and a `publishEvent(topic, payload)` utility that connects on first use, JSON-serializes the payload, and logs (rather than throws) on failure so a Kafka outage never fails the HTTP request that triggered the event. Also exports `disconnectProducer()` for clean shutdown/test teardown.
- Extended `src/middleware/validate.ts` with `validateQuery(schema)` (parses `req.query`, attaches result to `res.locals.query`) and `validateParams(schema)` (validates `req.params`, e.g. UUID path params) — both return the same `{ message, errors }` 400 shape as `validateBody`.
- Extended `src/config/redis.ts` with `deleteKeysByPattern(pattern)`, a non-blocking `SCAN`-based bulk key deletion (cursor-driven, `MATCH`/`COUNT`), used to clear all `search:*` cache entries at once.
- Added `src/modules/products/products.query.ts` — the shared `PRODUCT_SELECT` SQL (products joined to categories/users/inventory) and `toPublicProduct()` mapper, reused by both the products and search services so the response shape (including `availableStock`, category name, seller info) can't drift between the two.
- Rebuilt the `products` module (replacing the Step 1 placeholder):
  - `GET /api/v1/products` — public, paginated (`page`, `limit`, default 20).
  - `GET /api/v1/products/:id` — public, cache-aside in Redis (`product:{id}`, 10 min TTL).
  - `POST /api/v1/products` — seller only; creates the product and its `inventory` row (0 stock, DB defaults for the rest) in a single transaction; invalidates `search:*`.
  - `PUT /api/v1/products/:id` — seller only, must own the product (403 otherwise); partial update via a dynamically-built `SET` clause; invalidates `product:{id}` and `search:*`; publishes `product.updated`.
  - `DELETE /api/v1/products/:id` — seller only, must own the product; soft delete (`is_deleted = true`); invalidates `product:{id}` and `search:*` (not explicitly listed in the delete spec, but required for the "all queries filter `is_deleted = false`" invariant to hold immediately rather than up to 10 minutes later via a stale cache).
  - Every query filters `is_deleted = false`; every response includes `availableStock` (`total_stock - reserved_stock`), category name, and seller name/email.
- Rebuilt the `inventory` module (replacing the Step 1 placeholder):
  - `PUT /api/v1/inventory/:productId` — seller (own products only) or admin (any product); updates `total_stock`; invalidates `product:{id}` and `search:*` (stock feeds `availableStock` in cached responses); publishes `inventory.updated` only when the resulting `available_stock <= low_stock_threshold`.
  - `GET /api/v1/inventory/low-stock` — seller (own products) or admin (all products); lists products where `available_stock <= low_stock_threshold`.
  - Sellers are restricted to their own products on both endpoints even though the task described this as "seller/admin only" without repeating "own products only" — extending the same ownership rule already established for the products endpoints (see ARCHITECTURE.md security notes).
- Rebuilt the `search` module (replacing the Step 1 placeholder):
  - `GET /api/v1/search?q=&category=&minPrice=&maxPrice=&brand=&sortBy=&sortOrder=&page=&limit=` — `q` matched via `plainto_tsquery('english', ...)` against `products.search_vector`; `category` matched by slug; `minPrice`/`maxPrice`/`brand` as additional `WHERE` clauses; `sortBy` restricted to `price`/`created_at` and `sortOrder` to `asc`/`desc` by Zod (safe to interpolate directly into `ORDER BY` since only those literal values can pass validation).
  - Full response cached in Redis at `search:{md5(canonical query)}`, 5 min TTL; the cache key is built from the JSON-stringified, key-sorted validated query object, so equivalent queries in any parameter order hit the same cache entry.
  - Any product create or update deletes all `search:*` keys via `deleteKeysByPattern`.
- All new zod schemas live in `<module>.validation.ts` per module (`products.validation.ts`, `inventory.validation.ts`, `search.validation.ts`), consistent with `auth.validation.ts` from Step 3.
- Documented all 8 new endpoints in Swagger (`@openapi` JSDoc blocks on each route); `/api-docs` now lists 10 endpoints total.
- Verified end-to-end against the running local PostgreSQL + Redis + Kafka (KRaft-mode, no ZooKeeper) instances, including a live `kafka-console-consumer` on both topics: pagination, cache-aside hit/miss with correct TTL, RBAC (customer/other-seller/admin all rejected appropriately per endpoint), duplicate-SKU 409, soft delete filtered from every subsequent read, `product.updated` and `inventory.updated` payloads observed on their topics (including the conditional low-stock trigger firing only when appropriate), search filters/sort/pagination, cache-key reuse for repeated queries, and cache invalidation on both create and update.

## [Step 5] - Cart, Orders, Payments & Kafka

- Extended `src/config/kafka.ts`'s `KAFKA_TOPICS` with `ORDER_CREATED`, `ORDER_CANCELLED`, `PAYMENT_COMPLETED` (alongside the existing `PRODUCT_UPDATED`/`INVENTORY_UPDATED`), and exported the underlying `kafka` client instance so consumers can share it with the producer.
- Rebuilt the `cart` module (replacing the Step 1 placeholder), all endpoints customer-only:
  - `GET /api/v1/cart` — returns the cart with product name/price, per-item `subtotal`, `availableStock`, and a calculated `total`. Lazily creates an empty cart on first access (`findOrCreateCart`) rather than requiring one to pre-exist.
  - `POST /api/v1/cart/items` — validates the product exists, `is_available`, and that quantity (existing + requested, since it increments) doesn't exceed `available_stock`.
  - `PUT /api/v1/cart/items/:productId` — same validations, but sets the quantity absolutely rather than incrementing.
  - `DELETE /api/v1/cart/items/:productId`, `DELETE /api/v1/cart` — remove one item / clear the whole cart.
- Rebuilt the `orders` module (replacing the Step 1 placeholder):
  - `POST /api/v1/orders` — places an order from the customer's cart in a single `pg` client transaction (`BEGIN`/`COMMIT`/`ROLLBACK`): validate cart non-empty → lock and validate every cart item (`is_available`, quantity ≤ available stock) → increment `reserved_stock` per item → insert the order (`pending`) → insert `order_items` → clear `cart_items` → `COMMIT`. Any validation failure throws inside the transaction, which is caught and rolled back before the error propagates as a `400`.
  - **Deliberate reordering from the task's literal step list**: `product.created`'s publish and the product/search cache invalidation happen *after* `COMMIT`, not before it. Publishing before commit risks announcing an order that doesn't durably exist if the commit itself then failed (the dual-write hazard) — see ARCHITECTURE.md for the full rationale.
  - `GET /api/v1/orders` — customer sees only their own orders; admin sees all.
  - `GET /api/v1/orders/:id` — order plus its items and the *latest* payment's status (an order can have more than one payment attempt, per the Step 2 schema notes).
  - `PUT /api/v1/orders/:id/cancel` — customer only, own order only, only from `pending`/`confirmed`. Transaction: lock the order, release `reserved_stock` per item, set `cancelled`, commit — then claim a Redis idempotency marker (`order:stock-released:{orderId}`, `SET NX`) *before* publishing `order.cancelled`, so the async `InventoryConsumer` reacting to that same event sees the release already happened and skips re-decrementing.
  - `PUT /api/v1/orders/:id/status` — admin only. Enforces `pending→confirmed→shipped→delivered` as the *only* legal single-step transitions (e.g. `pending→shipped` is rejected). Transitioning to `delivered` decrements both `total_stock` and `reserved_stock` (stock permanently leaves the warehouse and its reservation is released in the same step) and invalidates the affected products' caches.
  - All locking (`FOR UPDATE` / `FOR UPDATE OF i`) verified under real concurrency: two customers placing simultaneous orders against a product with exactly 1 unit of stock — exactly one order succeeded, the other correctly received `400 Insufficient stock`, and `reserved_stock` ended at 1, never 2.
- Rebuilt the `payments` module (replacing the Step 1 placeholder):
  - `POST /api/v1/payments/initiate` — customer only; `orderId` + `paymentKey` in the body (`amount` is always derived server-side from `orders.total_amount`, never trusted from the client). If `paymentKey` already exists, returns the existing record with `200` (verified this is the *same* payment record, not a new insert, across two identical calls); otherwise inserts a `pending` payment and returns `201`. A duplicate-key race during insert (two concurrent requests with the same fresh key) is caught and resolved by re-reading the now-existing row rather than erroring.
  - `POST /api/v1/payments/process/:paymentId` — customer only, own payment, payment must be `pending`, order must still be `pending`. Mocked outcome (`Math.random() > 0.1`): success transactionally sets the payment `completed` and the order `confirmed`, then publishes `payment.completed`; failure sets the payment `failed` and returns `402` (order is left `pending`, so the customer can retry with a fresh `paymentKey`). Verified both outcomes live by looping the process call until each mocked branch was hit.
  - `POST /api/v1/payments/refund/:paymentId` — admin only, payment must be `completed`. Transaction: release `reserved_stock` per order item, set payment `refunded`, set order `cancelled`; invalidates affected product/search caches. Refunding a non-`completed` payment (e.g. already refunded) is rejected with `400`.
- Added `src/consumers/index.ts`, started from `server.ts` (not `app.ts`, so tests importing the Express app never spin up live Kafka consumers):
  - **AuditConsumer** (`groupId: audit-consumer`) — subscribes to every topic in `KAFKA_TOPICS` and logs `[AUDIT] {timestamp} | topic: {topic} | payload: {json}` for each message, exactly as specified.
  - **InventoryConsumer** (`groupId: inventory-consumer`) — subscribes only to `order.cancelled`; before decrementing, atomically claims the same `order:stock-released:{orderId}` Redis marker the synchronous cancel handler uses (`SET NX`). If the marker's already claimed (the common case, since the synchronous path runs first), it logs and skips; otherwise it performs the release itself — making the consumer safe against both duplicate delivery and the case where it's genuinely the only thing releasing the stock (e.g. future callers of `order.cancelled` that don't go through the HTTP cancel endpoint).
  - Verified live against a real local Kafka broker: both consumers join their consumer groups on boot; a placed order produces exactly one `order.created` audit line; a cancelled order produces both the `order.cancelled` audit line *and* an explicit "already released, skipping" log line from the InventoryConsumer, confirming the idempotency guard works rather than double-decrementing.
- All new request bodies/params validated with Zod (`cart.validation.ts`, `orders.validation.ts`, `payments.validation.ts`), consistent with prior steps.
- Documented all 11 new endpoints in Swagger; `/api-docs` now lists 19 endpoints total.

## [Step 6] - Tests, Observability & CI

- Added `prom-client` as a dependency.
- Added `src/config/metrics.ts` — a dedicated Prometheus `Registry` with 5 metrics: `http_requests_total` (counter; `method`, `route`, `status_code`), `http_request_duration_seconds` (histogram; `method`, `route`), `cache_hits_total` / `cache_misses_total` (counters; `key_pattern`), and `kafka_events_published_total` (counter; `topic`).
- Added `src/middleware/metricsMiddleware.ts`, recording the two HTTP metrics on every request. Reconstructs the route label (e.g. `/api/v1/products/:id`, not the raw UUID) from `req.originalUrl` + `req.route.path` rather than `req.baseUrl` — `baseUrl` gets reset by Express as an error propagates back out of a nested router, so it can't be trusted for error responses (a real bug caught and fixed while building this: error responses were briefly recorded under a route label missing their module prefix).
- Wired `cacheHitsTotal`/`cacheMissesTotal` into `ProductsService.getProductById` and `SearchService.search` (the two existing cache-aside call sites), and `kafkaEventsPublishedTotal` into `publishEvent` (Step 4).
- Added `GET /metrics` (no auth) in `src/app.ts`, serving `register.metrics()` in Prometheus exposition format.
- Added request-ID tracing: `src/utils/requestContext.ts` (an `AsyncLocalStorage`-based store), `src/middleware/requestId.ts` (generates a UUID per request, attaches it to `req.requestId`, sets it as the `X-Request-ID` response header, and runs the rest of the request inside the async context), and a `requestId` field merged into every Winston log line via a custom format in `config/logger.ts` — so any log emitted anywhere during a request's lifecycle (including from deep inside a service) is automatically tagged with that request's id, with zero per-call-site changes needed.
- Changed `validateBody`/`validateQuery`/`validateParams` (Step 3/4) to respond `422` instead of `400` on Zod validation failure, matching this step's test expectations and the standard REST convention of reserving `400` for business-rule violations (insufficient stock, wrong password, etc.) and `422` for "well-formed request, semantically invalid data." Updated every corresponding Swagger response doc across all modules.
- Changed `POST /api/v1/auth/logout` (Step 3) from `204 No Content` to `200` with a small JSON body, matching this step's test expectations.
- Added `TEST_DATABASE_URL` and made `config/env.ts` resolve `databaseUrl` to it whenever `NODE_ENV === 'test'` (which Jest sets automatically, additionally forced at the top of `jest.config.js` so it holds regardless of ambient shell state) — tests run against a fully separate `ecommerce_test` database, never the dev one.
- Rewrote `tests/setup.ts`: creates the test database on first run if it doesn't exist (connecting to the `postgres` maintenance database), runs migrations by shelling out to `scripts/migrate.ts` in its own `ts-node` process (node-pg-migrate's bundle is ESM-only and can't be parsed by `ts-jest` if imported directly into a test file's module graph — a real issue hit and fixed while building this), then **truncates every table and reseeds from scratch** before each test file runs (rather than just running the idempotent `seed()` — a second real bug caught in testing: incrementally seeding on top of a previous run's leftover data, e.g. stale items in the shared seeded customer's cart, silently broke later test runs), and clears all `ratelimit:*` Redis keys so each file gets a full rate-limit budget.
- Added `tests/helpers/auth.ts`: `getCustomerToken()` / `getSellerToken()` / `getAdminToken()` (each logs in once and memoizes the token for the rest of that test file, keeping total real logins per file well under the 5-per-15-minutes limit), `uniqueEmail()`, and `createDisposableCustomerToken()` (inserts a user directly via SQL and signs a matching JWT, bypassing the register/login rate limiters entirely — needed by the concurrency test, which requires many independent customer identities in one run).
- Added `tests/integration/auth.test.ts`, `products.test.ts`, `cart.test.ts`, `orders.test.ts`, `payments.test.ts` — all listed scenarios from the task, using freshly-created throwaway products/carts/orders per test rather than depending on exact seed-data values, so tests stay correct regardless of execution order.
- Added `tests/integration/concurrency.test.ts` — see `DOCS/TESTING-GUIDE.md` for a full explanation of what it proves; creates 10 independent disposable-customer carts against a product with `total_stock = 3`, fires all 10 `POST /orders` via `Promise.all`, and asserts exactly 3 succeed, `reserved_stock === 3`, and `available_stock === 0`.
- Added `scripts/test-concurrency.ts` — a standalone CLI script (`<productId> <requestCount>` args) that exercises the same property against a real running server over HTTP.
- Configured `jest.config.js` with `maxWorkers: 1`: the integration suite shares one real, mutable Postgres/Redis instance across files (the same seeded users' carts/orders); running files in parallel would make them race each other non-deterministically.
- Fixed a Kafka reliability issue found while testing without a running broker: kafkajs's default retry policy (5 retries, backoff up to 30s each) meant a single failed `publishEvent` connection attempt could block for minutes even though the call is designed to be best-effort. Configured `connectionTimeout: 2000` and `retry: { retries: 1, ... }` on the `Kafka` client so failures are fast, keeping the full suite's runtime around 12-25s with or without Kafka running.
- Rewired npm scripts: `"test": "jest"` (was unit-only), `"test:integration": "jest tests/integration"` (was `--passWithNoTests`, no longer needed now that real tests exist), `"test:concurrency": "ts-node scripts/test-concurrency.ts"` (was a Jest placeholder). Removed the now-superseded `tests/concurrency/` placeholder directory from Step 1.
- Added `.github/workflows/ci.yml`: three sequential jobs (`lint` → `test` → `build`) on push/PR to `main`. `test` runs with `postgres:16-alpine` and `redis:7-alpine` service containers (no Kafka service — the app's Kafka handling is designed to degrade gracefully without one, verified locally with Kafka stopped) and runs `npm run migrate`, `npm run seed`, then `npm test`. `build` runs `tsc --noEmit` and `docker build` against the existing `Dockerfile`.
- Rewrote `DOCS/HOW-TO-RUN.md` and `DOCS/TESTING-GUIDE.md` in full (see those files).

## [Step 7] - Hardening, Benchmarks & Release

Correctness fixes, each with a test that fails on the code before it:

- Checkout locks the customer's cart row, so a double-submitted checkout creates one order instead of two (measured: two orders in 9 of 10 trials before).
- A product soft deleted while in a cart now fails the order with `400` instead of being silently dropped from it.
- Payment processing locks the order and moves the payment out of `pending` with a conditional update, so several payments for one order can no longer all complete.
- Refunds require a `confirmed` order; cancelling a paid order marks its payment `refunded`.
- Cancel, refund and delivery lock inventory rows in `product_id` order through `inventory.stock.ts`, the same order checkout uses; the order row is always locked before the payment row.
- Refresh token rotation consumes the session with one `DELETE … RETURNING`, so a token is single-use under concurrency.
- The login rate limiter runs as one Lua script, so a burst cannot exceed the limit.
- A payment key reused for a different order returns `409`.
- Seed data reserves stock for the seeded open orders, so they can be cancelled and delivered.
- Setting stock below reserved stock returns `409`, an unknown category `400`, instead of `500`.
- Cache invalidation after commit is best effort, so a committed write is never reported as a `500`.
- Search pages are invalidated by incrementing a version counter instead of `SCAN`-ing the Redis keyspace, which made checkout 4–6× slower with 50,000 keys in Redis.
- `JWT_SECRET` is required in production; unmatched routes share one metrics label; 4xx responses are logged as warnings without stacks.

Cleanup and tooling:

- Shared helpers replace duplicated code: `utils/pgErrors.ts`, `utils/requireUser.ts`, `invalidateProductCaches`.
- New tests for search and inventory; 54 tests in total.
- Benchmark suite in `scripts/bench/` with `npm run bench`, recorded results in `scripts/bench/results/`.
- README rewritten; `DOCS/ARCHITECTURE.md` rewritten as a single top-to-bottom design document.
