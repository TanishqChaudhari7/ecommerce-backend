# Changelog

## [Unreleased]

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
