# E-Commerce Backend Architecture

This is the backend for an online store, written in TypeScript on Node.js and
Express, with PostgreSQL as the source of truth, Redis for caching and rate
limiting, and Kafka for domain events. This document describes the whole system,
from the schema up to the HTTP layer, and reads top to bottom. Measured numbers
appear only in §15; every one of them comes from the raw benchmark output in
`scripts/bench/results/`.

**Contents**

1. [Problem statement](#1-problem-statement)
2. [Requirements](#2-requirements)
3. [Non-goals](#3-non-goals)
4. [High-level architecture](#4-high-level-architecture)
5. [Data model](#5-data-model)
6. [Request pipeline](#6-request-pipeline)
7. [Authentication and authorization](#7-authentication-and-authorization)
8. [Catalog and search](#8-catalog-and-search)
9. [Caching](#9-caching)
10. [Checkout and inventory concurrency](#10-checkout-and-inventory-concurrency)
11. [Order lifecycle and payments](#11-order-lifecycle-and-payments)
12. [Events](#12-events)
13. [Observability](#13-observability)
14. [Benchmark methodology](#14-benchmark-methodology)
15. [Performance results](#15-performance-results)
16. [Tradeoffs](#16-tradeoffs)
17. [Failure modes](#17-failure-modes)
18. [Future improvements](#18-future-improvements)
- [Appendix: interview questions](#appendix-interview-questions)

---

## 1. Problem statement

A store sells a finite amount of stock to many customers at once. The hard part
is not listing products. It is making sure the store never promises the same
unit twice, while staying fast when most traffic is browsing.

Building that backend means answering five questions:

- **Stock is finite and contended.** When many customers check out the same
  item at the same moment, how is overselling made impossible rather than
  unlikely?
- **Checkout is several writes.** Reserving stock, creating the order, copying
  its lines and emptying the cart must all happen or none of them. How?
- **Clients retry.** A payment request whose response was lost will be sent
  again. How does a retry avoid charging twice?
- **Reads dominate.** Product pages and searches vastly outnumber purchases.
  How are they served without a database query each time, and without showing
  stale stock or prices?
- **Other systems need to know.** Auditing and inventory follow-up should not
  sit inside the request that caused them. How are they decoupled?

This codebase answers each one in a form small enough to explain file by file.

---

## 2. Requirements

### Functional

| Requirement | Implementation |
| --- | --- |
| Register, log in, refresh and log out | JWT access token plus rotating opaque refresh token (§7) |
| Three roles with different permissions | `customer`, `seller`, `admin`, enforced per route (§7) |
| Sellers manage their own products and stock | Ownership checks in the service layer (§8) |
| Browse, look up and search products | Paginated list, lookup by id, full-text search with filters (§8) |
| One cart per customer | `shopping_carts` with a unique `user_id` (§5) |
| Place an order from the cart without overselling | One transaction with row locks on inventory (§10) |
| Cancel, ship and deliver orders | Explicit status machine (§11) |
| Pay for an order, safely retryable; refund | Client-supplied idempotency key (§11) |
| Notify other systems of domain events | Kafka topics and two consumers (§12) |

### Non-functional

| Requirement | How it is met |
| --- | --- |
| No overselling under concurrent checkout | `SELECT … FOR UPDATE` on inventory rows, plus a `CHECK` constraint as a backstop (§10); an integration test and a benchmark exercise it (§15) |
| No partial orders | Explicit `BEGIN` / `COMMIT` / `ROLLBACK` on one connection (§10) |
| Hot reads served from memory | Cache-aside in Redis with invalidation on every write that changes the cached data (§9) |
| Brute-force resistance on login | Sliding-window rate limit per IP in Redis; bcrypt cost 12 (§7) |
| Every log line traceable to one request | Request id held in `AsyncLocalStorage` and added to every log line (§13) |
| Operational visibility | Prometheus metrics at `/metrics` (§13) |
| Correctness checked automatically | 41 Jest tests against real Postgres and Redis, including repeated race tests; lint, test, type-check and Docker build in CI (§13) |

---

## 3. Non-goals

Each of these is excluded deliberately.

- **A real payment provider.** `process` succeeds with probability 0.9 (`Math.random() > 0.1`). The integration point is where a provider call would go; the idempotency design around it is the point.
- **Horizontal scale-out.** One process, one Postgres, one Redis, one Kafka broker. Nothing prevents running several app instances (state lives in Postgres and Redis), but it has not been designed or tested for.
- **Guaranteed event delivery.** Events are published after commit, best effort, with no outbox (§12). Postgres is the record; Kafka is a notification.
- **Reservation expiry.** Stock reserved by an unpaid `pending` order stays reserved until the order is cancelled. There is no timeout.
- **Relevance ranking.** Search filters with full-text matching but sorts by price or date, never by `ts_rank` (§8).
- **Multi-currency, tax, shipping, discounts.** Prices are one `numeric(10,2)` column.
- **Graceful shutdown.** There is no `SIGTERM` handler; in-flight transactions are rolled back by Postgres when their connections drop.

---

## 4. High-level architecture

```
   frontend / curl / supertest
                  |
                  |  HTTP + JSON, Bearer access token
                  v
   +--------------------------------------------------+
   |  Express app          global middleware          |  src/app.ts
   |  requestId > helmet > cors > json > log > metrics|  src/middleware/
   +--------------------------------------------------+
                  |  /api/v1/<module>
                  v
   +--------------------------------------------------+
   |  Route         authenticateToken > requireRole > |  <module>.routes.ts
   |                validate (zod) > controller       |
   +--------------------------------------------------+
                  |  plain arguments, no req / res
                  v
   +--------------------------------------------------+
   |  Service       business rules, transactions,     |  <module>.service.ts
   |                cache reads and invalidation,     |
   |                event publishing                  |
   +--------------------------------------------------+
        |                    |                   |
        v                    v                   v
   +-----------+      +--------------+     +-----------+
   | PostgreSQL|      |    Redis     |     |   Kafka   |
   | source of |      | cache, rate  |     |  events   |
   | truth     |      | limits, flags|     |           |
   +-----------+      +--------------+     +-----------+
        ^                    ^                   |
        |                    |                   v
        +--------------------+------- consumers (same process)
                                      audit log, stock release
```

### Components

| Component | Responsibility | Files |
| --- | --- | --- |
| `createApp` | Middleware order, `/health`, `/metrics`, `/api-docs`, module mounting | `src/app.ts` |
| Entry point | Listen on a port, start Kafka consumers, process-level error handlers | `src/server.ts` |
| `env`, `logger` | Typed configuration; Winston logger with request ids | `config/env.ts`, `config/logger.ts` |
| `pool`, `redis`, `producer` | One shared client each for Postgres, Redis and Kafka | `src/config/db.ts`, `redis.ts`, `kafka.ts` |
| Metrics registry | Five Prometheus series | `src/config/metrics.ts` |
| Middleware | Request id, auth, roles, validation, rate limit, logging, metrics, errors | `src/middleware/*.ts` |
| `auth` module | Register, login, refresh, logout, `me` | `src/modules/auth/` |
| `products` module | List, lookup, create, update, soft delete | `src/modules/products/` |
| `search` module | Full-text search with filters, sort and pagination | `src/modules/search/` |
| `inventory` module | Set total stock; list low-stock products; `adjustOrderStock`, used by orders and payments | `src/modules/inventory/` |
| `cart` module | Cart contents for the current customer | `src/modules/cart/` |
| `orders` module | Checkout, list, view, cancel, status changes | `src/modules/orders/` |
| `payments` module | Initiate, process, refund | `src/modules/payments/` |
| Consumers | Audit log of every topic; stock release on `order.cancelled` | `src/consumers/index.ts` |
| `AppError` | An `Error` carrying an HTTP status code | `src/utils/AppError.ts` |
| Request context | `AsyncLocalStorage` holding the request id | `src/utils/requestContext.ts` |

### Module layout and the dependency rule

Every module has the same five files:

```
src/modules/<name>/
  <name>.routes.ts       Router: middleware chain per endpoint, Swagger comments
  <name>.controller.ts   HTTP only: read req, call service, write res, next(error)
  <name>.service.ts      Business rules: SQL, transactions, cache, events
  <name>.validation.ts   zod schemas and the types inferred from them
  <name>.types.ts        Row types and public response shapes
```

The rules, and where they are broken:

- **Controllers never touch `pool`, `redis` or Kafka.** They call exactly one service method and shape the response.
- **Services never see `req` or `res`.** They take plain values (`userId`, `role`, a validated body) and return plain objects. This is what lets them run from tests, scripts or consumers without an HTTP request.
- **Services do know HTTP status codes.** They throw `new AppError(404, …)`. This is a deliberate shortcut: a separate domain-error type mapped to status codes in one place would be cleaner, but would add a layer that does nothing else here.
- **Modules do not import each other's services.** The cross-module imports are types (`UserRole` from `auth`); `search` reusing `products.query.ts`, so that a product looks identical whether it came from `/products/:id` or `/search`; and `orders` and `payments` using `inventory/inventory.stock.ts`, so every stock release or consumption after checkout locks rows the same way (§10).
- **`app.ts` does not start consumers.** `server.ts` does. Tests import `app` without joining Kafka consumer groups or binding a port.

### Life of a request

```
  POST /api/v1/orders   Authorization: Bearer <jwt>
     -> requestIdMiddleware       new UUID; X-Request-ID header; AsyncLocalStorage
     -> helmet, cors, express.json
     -> requestLogger, metrics     register res.on('finish') hooks
     -> ordersRouter
          -> authenticateToken     verify JWT signature and expiry -> req.user
          -> requireRole('customer')
          -> OrdersController.placeOrder
               -> OrdersService.placeOrder(userId)
                    BEGIN
                    SELECT cart ... FOR UPDATE
                    SELECT cart items + inventory ... ORDER BY product_id FOR UPDATE OF i
                    validate every line; UPDATE inventory reserved_stock (one statement)
                    INSERT order; INSERT order_items (one statement); DELETE cart_items
                    COMMIT
                    DEL product:{id}...; SCAN+DEL search:*       Redis
                    publish order.created                         Kafka, best effort
                    read back the order (3 queries in parallel)
     <- 201 {"order": {...}}
     -> 'finish': access log line, http_requests_total, duration histogram
```

---

## 5. Data model

### Tables

```
  users 1 ---- * sessions
    |
    +-- 1 ---- * products * ---- 0..1 categories  (parent_id -> categories)
    |              |
    |              +-- 1 ---- 1 inventory
    |
    +-- 1 ---- 1 shopping_carts 1 ---- * cart_items * ---- 1 products
    |
    +-- 1 ---- * orders 1 ---- * order_items * ---- 1 products
    |              |
    +-- 1 ---- * payments * ---- 1 orders
```

| Table | Stores | Why it is separate |
| --- | --- | --- |
| `users` | Every account; `role` is an enum `customer`, `seller`, `admin` | One table keeps authentication uniform; the role drives authorization |
| `sessions` | Refresh tokens with expiry | Makes refresh tokens revocable by deleting a row (§7) |
| `categories` | Name, unique `slug`, optional `parent_id` | Nested categories without a second table |
| `products` | Catalog data, owner, `is_deleted`, `search_vector` | The sellable thing |
| `inventory` | `total_stock`, `reserved_stock`, `low_stock_threshold` | Stock is written far more often than catalog data and is what checkout locks (§10) |
| `shopping_carts` | One row per customer | Gives the cart an identity apart from its contents |
| `cart_items` | Product and quantity per cart | Unique on `(cart_id, product_id)`; adding again updates the quantity |
| `orders` | Owner, `status`, `total_amount` | The durable record of a purchase |
| `order_items` | Product, quantity, `unit_price` at order time | Later price changes never change what an order cost |
| `payments` | Attempts per order, `status`, unique `payment_key` | An order can have several attempts (failed, then retried) |

All primary keys are UUIDs from `gen_random_uuid()`. Money is `numeric(10,2)`,
converted to a JavaScript `number` at the service boundary.

### Constraints the database enforces

| Constraint | Protects against |
| --- | --- |
| `inventory.reserved_stock >= 0 AND reserved_stock <= total_stock` | Overselling or a double release, whichever code path causes it (§10) |
| `inventory.total_stock >= 0` | Negative stock |
| `inventory.product_id` unique | Two stock rows for one product |
| `shopping_carts.user_id` unique | Two carts per customer, even under a race in `findOrCreateCart` |
| `cart_items (cart_id, product_id)` unique | Duplicate lines |
| `payments.payment_key` unique | Two payments from one idempotency key, even under a race (§11) |
| `users.email`, `products.sku`, `categories.slug`, `sessions.refresh_token` unique | Duplicates; each unique constraint also creates the index used for lookups |
| `price`, `unit_price`, `amount`, `total_amount >= 0`; `quantity > 0` | Nonsense values |

Application checks are for good error messages. The constraints are for
correctness when an application check is missing or racing.

### Foreign keys and delete behaviour

| Reference | On delete | Reason |
| --- | --- | --- |
| `sessions.user_id` | `CASCADE` | A session means nothing without its user |
| `products.seller_id`, `orders.user_id`, `payments.user_id` | `RESTRICT` | Catalog and purchase history must not vanish with a user; users are deactivated with `is_active` instead |
| `order_items.product_id` | `RESTRICT` | An order line must always resolve to its product; this is why products are soft deleted |
| `products.category_id`, `categories.parent_id` | `SET NULL` | Removing a category orphans products and subcategories rather than deleting them |
| `inventory.product_id`, `cart_items.*`, `order_items.order_id`, `payments.order_id` | `CASCADE` | Owned rows go with their owner |

### Indexes

| Index | Serves |
| --- | --- |
| `products (seller_id)`, `products (category_id)` | A seller's catalog; browsing by category |
| `products (search_vector)` GIN | `@@` full-text matching (§8) |
| `orders (user_id)` | "My orders" |
| `orders (status)` | Admin queries by status |
| The unique constraints above | Login by email, lookup by SKU, slug, refresh token and payment key |

### Soft delete

Deleting a product sets `is_deleted = true`. Every customer-facing query repeats
`is_deleted = false`; there is no view or row-level policy enforcing it. Order
history still joins to the row, so an old order can still show its product's
name.

### Migrations and seed data

`node-pg-migrate` runs the ten files in `migrations/`, one per table, through
`npm run migrate`. `npm run seed` is idempotent: every seeded row has a fixed
UUID and every insert is `ON CONFLICT … DO NOTHING`. `npm run seed:fresh`
truncates every table first. The seed contains three users (`admin@test.com`,
`seller@test.com`, `customer@test.com`, password `Test@1234`), five categories
and twenty products.

---

## 6. Request pipeline

### Global middleware, in order

| # | Middleware | Why it is in this position |
| --- | --- | --- |
| 1 | `requestIdMiddleware` | First, so every later log line, including errors, carries the id (§13) |
| 2 | `helmet()` | Security headers on every response, errors included |
| 3 | `cors()` | Default settings allow every origin |
| 4 | `express.json()` | Parses the body before validation needs it |
| 5 | `requestLogger` | Measures time from here to `finish` |
| 6 | `metricsMiddleware` | Same, for Prometheus |
| — | `/health`, `/metrics`, `/api-docs`, `/api/v1/*` | Routes |
| last | `errorHandler` | Four-argument middleware, reached by `next(error)` |

### Per-route chain

```
  authenticateToken  ->  requireRole(...)  ->  validateParams / validateBody / validateQuery  ->  controller
       401                   403                              422                              2xx / AppError
```

Authentication runs before validation, so an anonymous caller learns nothing
about the shape of a request it may not make. On `/auth/login` and
`/auth/register` the rate limiter runs before validation, so malformed bodies
count against the limit too (§7).

### Validation

`zod` schemas live next to each module. A failure returns `422` with
`error.flatten()`, which lists problems per field. On success:

- `validateBody` replaces `req.body` with the parsed value, so defaults (for example `role: 'customer'`) and coercions are applied before the controller runs.
- `validateQuery` stores the parsed query, with numbers coerced and defaults applied, in `res.locals.query`, where controllers read it. `req.query` keeps the raw strings.
- `validateParams` only checks. Every path id must be a UUID, so a malformed id is a `422`, not a Postgres cast error.

Sort columns come from a fixed map (`price` → `p.price`), never from input.
Every value reaches SQL as a `$n` parameter.

### Errors

Services throw `AppError(status, message)`. Controllers wrap every call in
`try { … } catch (error) { next(error) }`. `errorHandler`:

- uses `err.statusCode`, or `500` if there is none;
- logs every error with its stack, method and path;
- in production, replaces the message of a `500` with `Internal server error` and omits every stack; outside production, returns both.

### Status codes used

| Code | Meaning here |
| --- | --- |
| `200`, `201`, `204` | Success; `201` for creation; `204` for a soft delete and for clearing the cart |
| `400` | A business rule refused the request: empty cart, insufficient stock, illegal status change |
| `401` | Missing or invalid access token; bad credentials; bad refresh token |
| `402` | Simulated payment failure |
| `403` | Wrong role, or not the owner of the resource |
| `404` | Missing resource |
| `409` | Duplicate email or SKU; a payment key reused for a different order |
| `422` | Input failed schema validation |
| `429` | Rate limited, with `Retry-After` |

---

## 7. Authentication and authorization

### Two tokens

| | Access token | Refresh token |
| --- | --- | --- |
| Form | JWT, HS256, `{ userId, email, role }` | 64 random bytes, hex encoded; opaque |
| Lifetime | `JWT_EXPIRES_IN`, default 15 minutes | `JWT_REFRESH_EXPIRES_IN`, default 7 days |
| Stored on the server | no | yes, a row in `sessions` |
| Checked by | signature and expiry only; no database read | a database lookup |
| Revocable | no; it expires | yes; delete the row |

The access token is checked on every authenticated request, so it has to be
cheap. The refresh token is used rarely and is the long-lived credential, so it
has to be revocable. Neither kind of token gives both properties alone.

The cost of a stateless access token: a role change or `is_active = false` does
not affect tokens already issued. They keep working for up to 15 minutes.

### Rotation

```
  POST /auth/refresh { refreshToken }
  1. DELETE FROM sessions WHERE refresh_token = $1
     RETURNING user_id, expires_at      no row  -> 401 Invalid refresh token
  2. expires_at < now                   -> 401 Refresh token expired
  3. load user                          missing or inactive -> 401 User no longer active
  4. issue a new access token and a new refresh token; INSERT the new session
```

Each refresh token works once. The session is consumed by one atomic `DELETE`,
so of two refreshes with the same token, even concurrent ones, exactly one gets
the row back; the other, and any later replay, gets a `401`. Every failure path
after step 1 would have deleted the session anyway, so deleting first loses
nothing.

### Roles

`authenticateToken` puts the verified payload on `req.user`. Its type comes
from a global augmentation of Express's `Request` in `src/types/express.d.ts`,
so it is available everywhere as `AccessTokenPayload | undefined`.
`requireRole(...roles)` is a factory that returns middleware checking
`req.user.role`.

| Endpoint group | Roles |
| --- | --- |
| `GET /products`, `GET /products/:id`, `GET /search` | public |
| `POST`, `PUT`, `DELETE /products` | `seller`, and only their own products |
| `PUT /inventory/:productId`, `GET /inventory/low-stock` | `seller` (own products) or `admin` |
| `/cart/*` | `customer` |
| `POST /orders`, `PUT /orders/:id/cancel` | `customer` (own orders) |
| `GET /orders`, `GET /orders/:id` | any role; non-admins see only their own orders |
| `PUT /orders/:id/status` | `admin` |
| `POST /payments/initiate`, `/process/:id` | `customer` (own orders and payments) |
| `POST /payments/refund/:id` | `admin` |

Roles are checked in middleware. Ownership is checked in services, because it
needs the resource's row: `403 You do not own this product` or
`… this order`.

### Rate limiting

A sliding window per route and IP, in one Redis sorted set whose scores are
millisecond timestamps. The steps run as one Lua script (`EVAL`):

```
  key = ratelimit:<route>:<ip>
  1. ZREMRANGEBYSCORE key 0 (now - window)     drop entries older than the window
  2. ZCARD key                                 requests still inside it
  3. count >= max  ->  return the oldest entry's timestamp
                       429, Retry-After = oldest entry + window - now
  4. otherwise     ->  ZADD key now "<now>-<random>";  PEXPIRE key window; return -1
```

| Route | Limit |
| --- | --- |
| `POST /auth/login` | 5 per 15 minutes per IP |
| `POST /auth/register` | 10 per hour per IP |

- **Sliding, not fixed.** A fixed window lets a client send `2 × max` requests across a boundary. Pruning by score makes the window always the last N minutes.
- **The member is unique per request.** Two requests in the same millisecond would otherwise collapse into one member and be undercounted.
- **It is atomic.** Redis runs a script without interleaving other commands. As four separate round trips, a burst of concurrent requests could all read a count below the limit and all be admitted; a test sends 15 simultaneous logins and requires exactly 5 through. `MULTI` would not be enough, because step 4 depends on the result of step 2.
- **It counts every request**, successful or not.

### Other security decisions

| Decision | Reason |
| --- | --- |
| bcrypt cost 12 | Slows offline guessing if `users` leaks |
| The same `401 Invalid email or password` for an unknown email, a wrong password or an inactive account | Does not confirm which part was wrong |
| Registration accepts `role` from the body | A known shortcut; anyone can register as `admin` (§17) |
| Refresh tokens stored in plain text | A leaked `sessions` table would expose live tokens; hashing them is listed in §18 |
| `JWT_SECRET` falls back to `change-me`, except in production | Convenient locally; with `NODE_ENV=production` and no secret, `config/env.ts` throws at startup rather than sign forgeable tokens |

---

## 8. Catalog and search

### Products

| Operation | Behaviour |
| --- | --- |
| Create | One transaction inserts the product and its `inventory` row (stock 0, threshold 10), so a product never exists without stock data; a duplicate SKU is `409` |
| Update | Owner only; builds `SET` from the fields present; publishes `product.updated` |
| Delete | Owner only; soft delete |
| List | Paginated by `page` and `limit` (at most 100), newest first; not cached |
| Get | Cache-aside through Redis (§9) |

Every read that returns a product uses the same `PRODUCT_SELECT` (products
joined to category, seller and inventory) and the same `toPublicProduct`
mapper. `availableStock = total_stock - reserved_stock` is computed on read and
never stored.

### Full-text search

`products.search_vector` is a `tsvector` kept current by a `BEFORE INSERT OR
UPDATE` trigger:

```sql
NEW.search_vector := to_tsvector('english',
  coalesce(NEW.name, '') || ' ' || coalesce(NEW.brand, '') || ' ' || coalesce(NEW.description, ''));
```

A trigger rather than application code means no write path can forget it. A
GIN index makes `@@` matching an index lookup instead of a scan.

`GET /search` builds a `WHERE` clause from whatever filters are present:

| Parameter | SQL |
| --- | --- |
| `q` | `p.search_vector @@ plainto_tsquery('english', $n)` |
| `category` | `c.slug = $n` |
| `minPrice`, `maxPrice` | `p.price >= $n`, `p.price <= $n` |
| `brand` | `p.brand ILIKE $n`, a case-insensitive exact match |
| always | `p.is_deleted = false` |
| `sortBy`, `sortOrder` | `price` or `created_at`, `asc` or `desc`; default `created_at desc` |

**Why `plainto_tsquery`.** It accepts any text a search box produces, stems it
with the English configuration and ANDs the terms together. `to_tsquery` would
fail on input such as `wireless mouse!`, because it expects operator syntax.

A search runs two queries, a `COUNT(*)` and the page, so the response can report
`total` and `totalPages`.

### Inventory endpoints

- `PUT /inventory/:productId { totalStock }` sets on-hand stock. The `CHECK` constraint rejects a value below `reserved_stock`. If the result leaves `available <= low_stock_threshold`, it publishes `inventory.updated` with the full snapshot, so a consumer does not need to query again.
- `GET /inventory/low-stock` lists products at or below their threshold, most urgent first; a seller sees only their own.

Only the explicit stock update checks the threshold. Checkout lowering
available stock does not publish `inventory.updated`.

---

## 9. Caching

### Pattern

Cache-aside: the service reads Redis first and falls back to Postgres.

```
  getProductById(id)
  1. GET product:{id}            hit  -> JSON.parse, cache_hits_total++, return
  2. cache_misses_total++
  3. SELECT ... WHERE p.id = $1 AND p.is_deleted = false     missing -> 404 (not cached)
  4. SET product:{id} <json> EX 600
  5. return
```

| Key | Value | TTL | Filled by |
| --- | --- | --- | --- |
| `product:{id}` | One `PublicProduct` | 600 s | `GET /products/:id` |
| `search:{md5}` | One page of results plus pagination | 300 s | `GET /search` |
| `ratelimit:{route}:{ip}` | Sorted set of timestamps | the window | Rate limiter (§7) |
| `order:stock-released:{orderId}` | `1`, a claim flag | 7 days | Cancellation (§12) |

**Search keys are canonical.** The key hashes the validated query after zod has
applied defaults, serialised with sorted keys:
`JSON.stringify(query, Object.keys(query).sort())`. `?q=mouse&page=1` and
`?page=1&q=mouse`, or an omitted `sortOrder` and an explicit `desc`, map to one
key.

**Dates are cached as strings.** `toPublicProduct` converts `Date` to ISO
strings before caching, so a hit and a miss return identical JSON.

### Invalidation

| Write | Deletes `product:{id}` | Deletes all `search:*` |
| --- | --- | --- |
| Create product | — | yes |
| Update product | yes | yes |
| Delete product | yes | yes |
| Set stock | yes | yes |
| Place order (reserves stock) | each product in the order | yes |
| Cancel order, refund (releases stock) | each product in the order | yes |
| Deliver order (removes stock) | each product in the order | yes |
| `InventoryConsumer` release | each product in the event | yes |

**Why every search key.** A cached page is the result of an arbitrary mix of
text, category, price range, brand, sort and page. Working out which cached
pages one changed product appears in, or changes the `total` of, would mean
re-running each query, which is the cost the cache exists to avoid. Writes are
rare compared with reads, so a brief cold search cache after each write is the
cheaper price for never showing a stale price or stock count.

**How.** `deleteKeysByPattern` iterates with `SCAN … MATCH search:* COUNT 100`
and deletes each batch. `KEYS` would block Redis, which is single-threaded, for
the whole scan. The cost is still proportional to the whole keyspace, not to the
matching keys, and it is paid on every order (§16).

### What the cache does not guarantee

- **A read racing a write can re-cache old data.** A miss reads the old row; the write commits and deletes the key; the miss then writes the old value back. It stays until the TTL expires. The window is one database round trip wide.
- **Redis is on the request path.** A cache read that fails is not caught, so the request fails instead of falling back to Postgres (§17).
- **Cache writes after commit can fail** after the database change has already committed. The client then gets a `500` for a write that took effect (§17).

---

## 10. Checkout and inventory concurrency

### Reserved stock

```
  inventory row          total_stock = 10   reserved_stock = 3   available = 7
                         ^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^
                         physically held    promised to open orders
```

| Event | `total_stock` | `reserved_stock` |
| --- | --- | --- |
| Order placed | — | `+ quantity` |
| Order cancelled or refunded | — | `− quantity` |
| Order delivered | `− quantity` | `− quantity` |
| Seller sets stock | `= value` | — |

Placing an order is not the moment stock leaves the warehouse. The order can
still be cancelled, the payment can fail, an admin can refund. If checkout
decremented `total_stock` directly, giving stock back would look exactly like
restocking. Keeping reservations separate makes `total_stock` change only when
physical stock changes, and makes `available` derivable from two columns.

### The transaction

`OrdersService.placeOrder` holds one pooled connection for the whole
transaction. `pool.query` would use any free connection for each statement, so
statements could not share a transaction.

```
  BEGIN
  1. SELECT id FROM shopping_carts WHERE user_id = $1 FOR UPDATE    lock the cart; no cart -> 400
  2. SELECT ci.product_id, ci.quantity, p.price, p.is_available, p.is_deleted,
            i.total_stock - i.reserved_stock AS available_stock
     FROM cart_items ci
     JOIN products  p ON p.id = ci.product_id
     JOIN inventory i ON i.product_id = p.id
     WHERE ci.cart_id = $1
     ORDER BY ci.product_id
     FOR UPDATE OF i                                                 lock every inventory row
                                                                     no rows -> 400 Cart is empty
  3. every line: not deleted, is_available,
     and quantity <= available_stock                                 any failure -> 400, ROLLBACK
  4. UPDATE inventory i SET reserved_stock = i.reserved_stock + u.quantity
     FROM unnest($1::uuid[], $2::int[]) AS u(product_id, quantity)
     WHERE i.product_id = u.product_id                               one statement for all lines
  5. INSERT INTO orders (user_id, 'pending', total)                  total from locked prices
  6. INSERT INTO order_items SELECT ... FROM unnest(...)             unit_price snapshot
  7. DELETE FROM cart_items WHERE cart_id = $1
  COMMIT
  --- after commit ---
  8. invalidate product:{id} for each line, and search:*
  9. publish order.created
  10. read the order back and return it
```

**Lock before checking.** The stock check in step 3 is meaningful only against
rows nobody else can change until commit. Checking first and locking later would
let another checkout slip in between.

**Why it is correct under `READ COMMITTED`.** Postgres's default isolation level
is used. When a `FOR UPDATE` waits on a row that another transaction then
updates and commits, Postgres re-reads the newest version of that row before
returning it. The waiting checkout therefore computes `available_stock` from the
stock the previous checkout left, not from the value before it waited.

```
  checkout A                               checkout B  (same product, stock 1)
  BEGIN                                    BEGIN
  SELECT ... FOR UPDATE OF i  -> locked
    available = 1                          SELECT ... FOR UPDATE OF i   (waits)
  UPDATE reserved + 1
  INSERT order ...
  COMMIT                     -> released   -> row re-read: available = 0
                                           quantity 1 > 0 -> 400 Insufficient stock
                                           ROLLBACK
```

**Why `ORDER BY ci.product_id`.** Two carts holding products X and Y in
different orders could otherwise lock X then Y and Y then X, and deadlock.
Sorting gives every checkout the same lock order, so a cycle cannot form. §15
includes a probe built to provoke exactly that case.

**Why `FOR UPDATE OF i`.** Of the joined tables, only inventory rows are
locked. Products and cart items are read but not locked, so checkouts do not
block catalog edits, and checkouts of different products never wait for each
other.

**Why lock the cart as well.** Without it, one customer double-submitting
checkout gets two orders. Both requests lock the same inventory rows; the second
waits, then re-reads the inventory rows, but not the cart items, which it still
sees in the snapshot its statement started with. It reserves stock again and
creates a second order from a cart the first request already emptied. Measured
before the fix, this happened in 9 of 10 trials (§15). With the cart row locked
first, the second request waits at step 1, and its step 2 is a new statement
that sees the emptied cart: `400 Cart is empty`. Carts belong to one customer,
so this lock never makes two customers wait for each other, and §15 measured no
throughput cost.

**Deleted products fail the order.** A product soft deleted while it sat in a
cart used to be filtered out by the join, so the order was silently placed
without it and the line removed with the rest of the cart. The line is now read
and rejected like an unavailable product.

**All or nothing.** One bad line fails the whole order and reserves nothing. A
partial order would be a worse result for the customer than a clear refusal, and
it keeps one order equal to one consistent total.

**One statement per step.** Reserving stock and inserting order lines use
`unnest` over arrays, so a cart of N items costs a fixed number of round trips
instead of 2N while the locks are held.

**Commit before publishing.** Publishing `order.created` before `COMMIT` could
announce an order that a failed commit never created. `publishEvent` never
throws (§12), so publishing after commit costs nothing in correctness.

### Rollback

Every multi-statement write has the same shape:

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // ... statements, any of which may throw ...
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

A deliberate `AppError`, a constraint violation or a lost connection all reach
`ROLLBACK`. Postgres discards everything since `BEGIN`, and `finally` always
returns the connection to the pool. Used by `createProduct`, `placeOrder`,
`cancelOrder`, `updateStatus`, the success path of `process`, and `refund`.

### Releasing and consuming stock after checkout

Cancellation and refund release a reservation; delivery consumes it. All three
go through `adjustOrderStock(client, orderId, 'release' | 'consume')` in
`src/modules/inventory/inventory.stock.ts`, inside the caller's transaction. It
locks the order's inventory rows with `ORDER BY product_id … FOR UPDATE`, the
same global order checkout uses, then applies one `unnest` update. Updating row
by row in whatever order `order_items` returned could lock Y then X while a
checkout holds X and waits for Y.

Every transaction that touches an order and its payment also locks them in one
order: the order row first, then the payment row (`cancelOrder`,
`updateStatus`, `process`, `refund`).

### The backstop

`CHECK (reserved_stock >= 0 AND reserved_stock <= total_stock)` holds whatever
the application does. If the lock were removed, an oversell would fail at the
`UPDATE` with a constraint violation (a `500`) instead of committing. The lock
exists to turn that into a clean `400`; the constraint makes an oversell
impossible either way.

### What is and is not protected

| Scenario | Protected by | Result |
| --- | --- | --- |
| Many customers, one product, little stock | Inventory row lock | Exactly the stock is sold (§15) |
| Carts sharing products in different orders | Sorted lock order | No deadlock (§15) |
| Stock set below current reservations | `CHECK` constraint | Rejected |
| One customer submitting checkout twice at once | Cart row lock | One order; the second request gets `400 Cart is empty` (§15) |
| Cancel, refund or delivery racing a checkout on shared products | Same sorted lock order | No deadlock |
| Two carts' stock checks at add-to-cart time | Nothing; it is advisory | Checkout re-checks under the lock |

---

## 11. Order lifecycle and payments

### Status machine

```
                    payment completes          admin            admin
     placeOrder  ->  pending  ------------>  confirmed  ---->  shipped  ---->  delivered
                        |                        |                              (stock leaves:
                        | customer cancels       | customer cancels,            total and reserved
                        v                        v admin refunds                both decrease)
                    cancelled                cancelled
                   (reservation released)   (reservation released,
                                             payment refunded)
```

| Transition | Triggered by | Side effect |
| --- | --- | --- |
| → `pending` | `POST /orders` | Stock reserved |
| `pending` → `confirmed` | `POST /payments/process/:id` succeeding | Payment `completed`, same transaction |
| `confirmed` → `shipped` → `delivered` | `PUT /orders/:id/status` (admin) | On `delivered`, total and reserved stock both decrease |
| `pending` or `confirmed` → `cancelled` | `PUT /orders/:id/cancel` (owner) | Reservation released; a `completed` payment is marked `refunded`; `order.cancelled` published |
| `confirmed` → `cancelled` | `POST /payments/refund/:id` (admin) | Payment `refunded`; reservation released |

`ALLOWED_TRANSITIONS` maps each status to its single successor
(`pending → confirmed → shipped → delivered`). The admin endpoint accepts only
that successor, so `pending → shipped` and `confirmed → confirmed` are both
`400`. The zod schema already excludes `pending` and `cancelled` as targets.
`cancelled` and `delivered` are terminal. Status changes lock the order row
(`SELECT … FOR UPDATE`), so two admins cannot apply conflicting transitions.

A `confirmed` order has been paid for, so cancelling it also marks its
`completed` payment `refunded`, in the same transaction. Otherwise the customer
would lose both the goods and the money.

### Idempotent payment initiation

`paymentKey` is chosen by the client, typically a UUID generated once per
checkout attempt, and is unique in the database.

```
  POST /payments/initiate { orderId, paymentKey }
  1. SELECT by payment_key       found, same user and order -> 200, the existing payment
                                 found, other user          -> 403
                                 found, other order         -> 409
  2. load the order              missing -> 404; not the caller's -> 403
  3. INSERT (amount = orders.total_amount, status 'pending')   -> 201
       unique violation (a concurrent request inserted first)
         -> SELECT by key and return that row                  -> 200
```

| Case | Result |
| --- | --- |
| First request | New `pending` payment, `201` |
| Retry after a lost response | The same payment, `200`; no second row |
| Two first requests racing | One insert wins; the other hits the unique constraint and returns the winner's row |

The `SELECT` in step 1 is an optimisation for the common retry. The unique
constraint is what actually guarantees one payment per key.

**The amount is never taken from the request.** It is copied from
`orders.total_amount`. A retry must not be able to change what is charged; if
the client supplied the amount, an idempotency key would not guarantee that.

**The key is bound to its order.** Reusing a key with a different `orderId` is a
`409`. Returning the original payment would tell the client it is paying one
order while it holds a payment for another.

A payment that has `failed` stays failed. Retrying with the same key returns the
failed record, and `process` refuses it. A new attempt needs a new key.

### Processing

```
  POST /payments/process/:id
  unlocked reads: payment exists, is the caller's, is pending     fast 404 / 403 / 400
  "call the provider": success = Math.random() > 0.1
  BEGIN
  1. SELECT status FROM orders WHERE id = $1 FOR UPDATE           not pending -> 400
  2. UPDATE payments SET status = completed | failed
     WHERE id = $1 AND status = 'pending' RETURNING *             no row -> 400 already processed
  3. success: UPDATE orders SET status = 'confirmed'
  COMMIT
  failure -> 402 (the failed status is committed first)
  success -> publish payment.completed
```

The unlocked reads only produce quick, specific errors. Correctness comes from
the transaction:

- **The order lock** serialises every attempt to pay one order. An order can have several `pending` payments (one per key); without the lock, processing them concurrently completed all of them. The test that processes four payments for one order at once found all four completed when run against the code before the fix.
- **The conditional `UPDATE`** makes one payment's transition from `pending` happen once, even if the same payment is processed twice at the same moment.

### Refunds

`refund` reads the payment's order id, then locks the order, then the payment.
It requires the payment to be `completed` and the order to be `confirmed`:
paid, but not yet shipped. It releases the reservation, marks the payment
`refunded` and the order `cancelled`, all in one transaction.

Refusing shipped and delivered orders matters for stock. A delivered order's
reservation has already been consumed, so releasing it again would take
`reserved_stock` below zero (before the fix, a `500` from the `CHECK`
constraint) or, if other orders held reservations of the product, silently free
theirs. Returns after shipping would need their own flow (§18).

---

## 12. Events

### Producer

```ts
publishEvent(topic, payload)
  1. connect the producer on first use (a module-level flag)
  2. send one JSON message to the topic
  3. kafka_events_published_total{topic}++
  on any error: log it and return; never throw
```

A single `kafkajs` producer is created when the module loads but connects only
on the first publish, so importing the app (as the tests do) opens no sockets.

**Why events never fail a request.** An event reports something that has
already committed. If the broker is down, a seller's price change should still
return `200`. Losing an event to a broker outage is accepted at this scope; an
outbox table written in the same transaction would remove that loss (§18).

**Fail fast.** The client is configured with `connectionTimeout: 2000` and one
retry (at most 1 s backoff). The `kafkajs` defaults (5 retries, backoff up to
30 s) could hold a request for minutes when the broker is unreachable, which
would defeat "never block the request".

### Topics

| Topic | Published by | Payload |
| --- | --- | --- |
| `product.updated` | `updateProduct` | `productId`, `sellerId`, `updatedAt` |
| `inventory.updated` | `updateStock`, only at or below the threshold | `productId`, `totalStock`, `reservedStock`, `availableStock`, `lowStockThreshold` |
| `order.created` | `placeOrder`, after commit | `orderId`, `userId`, `items[]` with `unitPrice`, `totalAmount` |
| `order.cancelled` | `cancelOrder`, after commit | `orderId`, `userId`, `items[]` |
| `payment.completed` | `process`, after commit | `paymentId`, `orderId`, `userId`, `amount` |

Messages have no key, so the default partitioner spreads them and there is no
per-order ordering guarantee.

### Consumers

`startConsumers()` runs in the same process, started by `server.ts`. If it fails,
the error is logged and the server keeps serving without consumers.

| Consumer | Group | Topics | Does |
| --- | --- | --- | --- |
| `AuditConsumer` | `audit-consumer` | every value in `KAFKA_TOPICS` | Logs `[AUDIT] <time> \| topic \| payload`; a new topic is picked up with no code change |
| `InventoryConsumer` | `inventory-consumer` | `order.cancelled` | Releases the order's reservation, unless it has already been released |

### Exactly-once stock release

Cancellation releases stock twice over: synchronously in `cancelOrder`'s
transaction, and again in `InventoryConsumer` when the event arrives.
Unguarded, every cancellation would be released twice. Both sides therefore
claim one Redis key, and only the side that wins the claim does the work:

```
  cancelOrder                                  InventoryConsumer
  BEGIN
  release reservations
  status = cancelled
  COMMIT
  SET order:stock-released:{id} 1 NX EX 7d   (claims)
  publish order.cancelled  ------------------>  SET order:stock-released:{id} 1 NX EX 7d
                                                -> not claimed: log "already released", skip
```

The synchronous path claims before it publishes, so on the normal path the
consumer always loses. The consumer's release exists for cancellations that do
not come through this endpoint.

A second layer does not depend on Redis: the consumer's update is
`GREATEST(reserved_stock - quantity, 0)`, and the `CHECK` constraint forbids a
negative value, so even a lost claim key cannot drive the column below zero.

---

## 13. Observability

### Request ids

```
  requestIdMiddleware
    id = randomUUID()
    req.requestId = id;  res.setHeader('X-Request-ID', id)
    runWithRequestId(id, next)        AsyncLocalStorage.run({ requestId }, next)
         |
         |  every await below stays inside this async context
         v
  logger.error(...) anywhere          a Winston format calls getRequestId()
                                      and adds it to the log line
```

The id is never passed as an argument, yet every log line during the request
carries it: middleware, services, the error handler. The client gets the same
id in `X-Request-ID`, so a report ("error at 15:47") maps to that request's log
lines with one search.

### Logs

Winston, level from `LOG_LEVEL`. Development prints coloured
`HH:mm:ss [level] [requestId] message`. Production prints one JSON object per
line. `requestLogger` writes one `http`-level access line per response:
`METHOD url status - N.Nms`.

### Metrics

`GET /metrics`, Prometheus text format, one registry:

| Metric | Type | Labels | Answers |
| --- | --- | --- | --- |
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Traffic and error rate per endpoint |
| `http_request_duration_seconds` | Histogram | `method`, `route` | Latency percentiles per endpoint |
| `cache_hits_total` | Counter | `key_pattern` (`product`, `search`) | Hit ratio per cache |
| `cache_misses_total` | Counter | `key_pattern` | |
| `kafka_events_published_total` | Counter | `topic` | Whether events actually reach the broker |

**The route label is the pattern, not the URL.** `/api/v1/products/:id`, not
one series per UUID. Building it from `req.baseUrl + req.route.path` fails for
errors: when `next(error)` unwinds out of a module router, Express resets
`req.baseUrl`, so error responses were recorded as `/:id`. The middleware
instead takes `req.originalUrl`, removes as many trailing segments as
`req.route.path` has, and appends `req.route.path`. Neither input is reset.

Requests that match no route are all labelled `unmatched`. Using the raw path
would create a new series for every distinct unknown URL anyone sends.

### Tests

| Suite | Scope | Count |
| --- | --- | ---: |
| `tests/unit/health.test.ts` | `/health` shape | 1 |
| `tests/integration/auth.test.ts` | Register, duplicate, validation, login, refresh, logout, concurrent refresh | 9 |
| `tests/integration/rateLimit.test.ts` | A burst of 15 logins admits exactly 5 | 1 |
| `tests/integration/products.test.ts` | List, get, RBAC, ownership, soft delete | 7 |
| `tests/integration/cart.test.ts` | Add, stock limit, unavailable, update, remove, clear | 6 |
| `tests/integration/orders.test.ts` | Place, empty cart, insufficient stock, cancel, lifecycle, double submit, deleted product | 8 |
| `tests/integration/payments.test.ts` | Initiate, idempotent retry, process, refund, refund after shipping, cancel refunds, key reuse, concurrent processing | 8 |
| `tests/integration/concurrency.test.ts` | 10 simultaneous checkouts for 3 units | 1 |

A race shows up only some of the time, so the double-submit, concurrent-refresh
and concurrent-processing tests each repeat 10 independent trials. All three
fail against the code before the fixes described in §7, §10 and §11, and pass
after them.

Integration tests run the real app in process through `supertest`, against a
real Postgres and Redis. `tests/setup.ts` creates `ecommerce_test` if missing,
runs migrations in a child process (the migration library is ESM-only and
cannot load under `ts-jest`), truncates every table, reseeds and clears rate
limit keys before each file. Files run serially (`maxWorkers: 1`) because they
share the seeded users' carts. Kafka is optional: publishing fails fast and is
logged.

CI (`.github/workflows/ci.yml`) runs `lint` → `test` (Postgres and Redis service
containers, `migrate`, `seed`, `npm test`) → `build` (`tsc --noEmit`,
`docker build`).

---

## 14. Benchmark methodology

### Benchmarks

| Script | Measures |
| --- | --- |
| `scripts/bench/cache.ts` | `GET /products/:id` latency and throughput, cache miss against cache hit, sequential and 50 in flight, over an 8,000-product catalog |
| `scripts/bench/throughput.ts` | `POST /orders` throughput, 1 in flight against 32, with orders spread across products and with all on one product |
| `scripts/bench/oversell.ts` | 200 buyers, 50 units, 64 in flight: orders confirmed, units reserved |
| `scripts/bench/deadlock.ts` | 200 five-item carts over 20 shared products, half in reverse order, 32 in flight |

Further runs, whose output is in `scripts/bench/results/`, test specific
suspicions from reading the code:

| Run | Output |
| --- | --- |
| One customer, two simultaneous checkouts, 10 trials, after the fix | `double-submit.txt` |
| The same probe before the fix | `before-fixes/double-submit.txt` |
| Refund of a payment whose order was already delivered, before the fix | `before-fixes/refund-after-delivery.txt` |
| `throughput.ts` with and without the cart row lock, alternating | `ab-cart-lock.txt` |

### Rules

| Rule | Reason |
| --- | --- |
| Production build (`npm run build`, `node dist/src/server.js`, `NODE_ENV=production`, `LOG_LEVEL=error`) | `ts-node` and debug-level logging would measure the tooling |
| The client is a separate Node process using `fetch` over loopback | Measures the full HTTP path, as a client would see it |
| Fixtures are inserted straight into Postgres before timing | Setup is not part of what is measured |
| Every buyer has their own user and cart; tokens are signed directly | Login rate limits would otherwise cap the run |
| Each cache sample uses a never-requested id for the miss, then the same id for the hit | The two arms do identical work apart from the cache |
| A warm-up before measuring (50 lookups; 1 order) | JIT compilation and pool growth are not charged to the first arm |
| Throughput from the wall time of the whole run | Not limited by timer resolution |
| `cache.ts` and `throughput.ts` run three times; medians reported with ranges | One run on a laptop proves little |
| Bench rows are deleted afterwards | The dev database is left as it was |

### Limits of the measurements

- **One machine, not isolated.** Client, server, Postgres and Redis share a laptop's cores; load average at the start was 3.19. Separate sessions on the same machine differ by more than some of the effects measured (§15).
- **Loopback only.** No real network latency between the app and its clients or its databases. Over a network each round trip costs more, which favours the cache and penalises multi-query endpoints more than these numbers show.
- **The Postgres pool has 10 connections** (the `pg` default; `db.ts` sets no `max`). Every concurrent arm has more requests in flight than connections, so they also measure queueing for a connection.
- **Small data.** At most 8,000 products; everything fits in Postgres's buffer cache.
- **`oversell.ts` and `deadlock.ts` ran once.** They check correctness, not speed, and their outcomes are counts.
- **`scripts/bench/checkout.ts` was not run.** It starts with `FLUSHALL`, which would erase the whole development Redis instance.

---

## 15. Performance results

Every number here is taken from `scripts/bench/results/`. The machine is an
Apple M2 Pro (12 cores) with 16 GB of RAM, running macOS 26.5.2, Node
v25.8.2, PostgreSQL 16.14 and Redis 8.6.2, all local. The code is commit
`8a8a271` plus the uncommitted changes listed in `environment.txt`: the sorted
lock order and batched statements in checkout, and the fixes described in §7,
§10 and §11. Timing figures are medians of three runs.

### Summary

| Measurement | Result |
| --- | --- |
| `GET /products/:id`, one at a time | hit 0.28 ms, miss 0.56 ms mean; −59.3% median per-run change |
| `GET /products/:id`, 50 in flight | hit 18,453, miss 9,757 req/s; +76.1% median per-run gain |
| Checkout throughput, 32 in flight, no shared products | 1,523.3 orders/s (10.18× one at a time) |
| Checkout throughput, 32 in flight, every order on one product | 911.5 orders/s (6.35× one at a time) |
| 200 buyers for 50 units | 50 confirmed, 150 rejected with `400`, 0 errors, 0 oversold |
| 200 overlapping carts in opposite lock orders | 200 of 200 succeeded, no deadlocks |
| One customer, two simultaneous checkouts | one order in 10 of 10 trials (before the fix: two orders in 9 of 10) |
| Cost of the cart row lock | none measurable |

### Product lookup: cache against database

`cache.ts`, 8,000 products, 200 sequential samples per arm:

| Arm | Mean | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| Miss (Postgres) | 0.56 ms | 0.54 ms | 0.77 ms | 1.07 ms |
| Hit (Redis) | 0.28 ms | 0.24 ms | 0.35 ms | 1.13 ms |

Mean latency fell by 64.6%, 59.3% and 50.0% in the three runs.

2,000 requests, 50 in flight:

| Arm | req/s | Mean | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Miss (Postgres) | 9,757 | 5.06 ms | 4.36 ms | 8.98 ms | 11.18 ms |
| Hit (Redis) | 18,453 | 2.67 ms | 2.45 ms | 5.96 ms | 7.24 ms |

Throughput gain per run: +92.9%, +76.1%, +65.9%.

What the data shows:

- **A hit is about 0.3 ms cheaper than a miss** on loopback. The miss is one indexed query joining four tables plus a Redis `SET`; the hit is one Redis `GET`.
- **The difference matters more under load.** With 50 requests in flight and 10 database connections, misses queue for a connection; hits never take one. Throughput nearly doubles.
- **A hit is not free.** It still costs about 0.25 ms. The benchmark does not split that between HTTP handling, middleware, JSON and the Redis round trip.
- **Tails are noisy.** The sequential hit p99 (1.13 ms) is above the miss p99 (1.07 ms); across runs the hit p99 ranged from 0.50 ms to 1.33 ms and the miss p99 from 0.83 ms to 2.69 ms. With 200 samples, p99 is the second-slowest request, so one scheduling hiccup moves it.
- **Per-run changes and ratios of medians differ.** The medians in the tables give 9,757 → 18,453 req/s (+89%), but the three paired runs gave +92.9%, +76.1% and +65.9%; the summary uses the median paired change.

### Checkout throughput

`throughput.ts`, one-item carts, 300 orders per arm (299 for the first arm, whose
first buyer is the warm-up):

| Arm | orders/s | Mean | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Spread, 1 in flight | 131.1 | 7.63 ms | 7.41 ms | 9.43 ms | 13.57 ms |
| Spread, 32 in flight | 1,523.3 | 20.35 ms | 19.02 ms | 33.82 ms | 37.72 ms |
| One product, 1 in flight | 142.5 | 7.01 ms | 7.06 ms | 8.72 ms | 16.36 ms |
| One product, 32 in flight | 911.5 | 34.04 ms | 28.47 ms | 62.30 ms | 83.71 ms |

Each cell is the median across the three runs, taken per column.

| Speed-up of 32 in flight over 1 | Run 1 | Run 2 | Run 3 | Median |
| --- | ---: | ---: | ---: | ---: |
| Spread | 8.78× | 11.62× | 10.18× | 10.18× |
| One product | 4.53× | 6.35× | 6.40× | 6.35× |

What the data shows:

- **A checkout takes about 7 ms end to end** when nothing else is running: around ten round trips to Postgres, a Redis delete, a `SCAN` of the Redis keyspace and a Kafka publish.
- **Concurrency multiplies throughput about tenfold** when orders do not share products, while each order waits under three times longer. The likely reason is that most of a checkout is spent waiting on round trips, and those overlap across requests.
- **A hot product costs a third of the throughput.** Concurrent throughput on a single inventory row was 37.5% below spread orders (median; the three runs ranged from −27.3% to −41.5%), and its p99 more than doubled. Every checkout of that product waits its turn for one row lock.
- **The data does not isolate the ceiling.** The concurrent arms queue for 10 pool connections, share cores with Postgres and the client, and scan the Redis keyspace on every order. Separating those would need profiling that was not done.
- Every order in every throughput run succeeded.

### Cost of the cart row lock

The cart lock added in §10 changes the checkout path, so it was measured
separately. `ab-cart-lock.txt` runs `throughput.ts` four times, alternating
between two builds that differ only in that one statement:

| 32 in flight | Without lock | With lock |
| --- | --- | --- |
| Spread | 1,110.6 and 1,160.4 orders/s | 1,182.8 and 1,225.1 orders/s |
| One product | 1,077.4 and 1,150.0 orders/s | 1,144.3 and 1,190.2 orders/s |

The runs with the lock were no slower. This is expected: carts belong to one
customer, and each buyer in the benchmark has their own, so the lock is never
contended.

The same session also shows how much the machine varies. The one-product arm
ran at 891–975 orders/s in the three main runs and at 1,077–1,190 orders/s in
the A/B runs minutes later, with the same code. Differences of that size
between sessions are noise, not an effect of the code.

### Correctness under concurrency

`oversell.ts`, 200 buyers, 1 unit each, stock 50, 64 in flight:

| Confirmed (`201`) | Rejected (`400`) | Errors (`5xx`) | Total / reserved stock | Oversold |
| ---: | ---: | ---: | --- | ---: |
| 50 | 150 | 0 | 50 / 50 | 0 |

Exactly the stock was sold. Every rejection was a `400` and none was a `5xx`. A
`CHECK` violation would have surfaced as a `500`, so the row lock turned the
losers away, not the backstop.

`deadlock.ts`, 200 buyers with five items each from a pool of 20 products, even
and odd buyers holding the same items in opposite orders, 32 in flight:

| Succeeded | Deadlocks or other errors |
| ---: | ---: |
| 200 | 0 |

This run covers only the code with sorted locks. No comparison run without the
`ORDER BY` was made.

One customer, two simultaneous `POST /orders`, 10 trials:

| | Trials with one order | Trials with two orders |
| --- | ---: | ---: |
| Before the fix (`before-fixes/double-submit.txt`) | 1 | 9 |
| After the fix (`double-submit.txt`) | 10 | 0 |

After the fix, every trial returned one `201` and one `400`, with the cart's 2
units reserved once.

`before-fixes/refund-after-delivery.txt`: before the fix, refunding a payment
whose order was already delivered returned `500`. The release would have taken
`reserved_stock` below zero, so the `CHECK` constraint rejected it and the
transaction rolled back. The same request is now refused with `400` before any
stock is touched; a test covers the shipped case.

---

## 16. Tradeoffs

| Decision | Benefit | Cost |
| --- | --- | --- |
| Raw SQL through `pg`, no ORM | Every query is visible; locking and `unnest` batching are explicit | Hand-written mapping; conventions such as `is_deleted = false` repeated in every query |
| `reserved_stock` beside `total_stock` | Cancellation and refund are exact inverses; physical stock changes only on delivery | Two counters to keep consistent; stock is held by unpaid orders with no expiry |
| Pessimistic row locks at checkout | Overselling impossible; a clean `400` for the loser | Checkouts of one product run one at a time through the lock; 37.5% lower throughput for a single hot product (§15) |
| `READ COMMITTED` with `FOR UPDATE` | No serialisation failures to retry | Correctness depends on locking the right rows, in a consistent order; a missed lock is a silent race, as the cart was (§10) |
| Stateless JWT access tokens | No database read per request | Role changes and deactivation take effect only when the token expires |
| Opaque refresh tokens in a table | Revocable; single use, even under concurrency | A database write per refresh |
| Cache-aside with blanket `search:*` invalidation | Simple and never stale after a write completes | Every write scans the whole Redis keyspace; search is cold after each write |
| Redis on the request path without fallback | Simple code | A Redis outage takes down cached reads, rate-limited routes and writes that invalidate (§17) |
| Best-effort events after commit | Requests never fail because of Kafka | Events can be lost; no ordering per order |
| Consumers in the web process | One thing to deploy | A consumer problem shares CPU and memory with request handling |
| Client-chosen payment key, server-derived amount | Safe retries; amount cannot change | A failed payment needs a new key |
| Services throw `AppError` with HTTP codes | Short, direct code | The business layer knows about HTTP |
| Order totals summed as JavaScript numbers | Simple | Floating-point sums, rounded again by `numeric(10,2)` on insert; integer cents would be exact |
| Default `pg` pool of 10 | No tuning needed at this scale | Concurrent requests queue for a connection (§15) |

---

## 17. Failure modes

| Failure | Behaviour |
| --- | --- |
| Two checkouts for the same product | One waits on the inventory row lock; the loser gets `400 Insufficient stock` |
| The same customer submits checkout twice at once | The second waits on the cart row lock, then gets `400 Cart is empty` (§15) |
| A cart line whose product has been soft deleted | The whole order is refused with `400`; nothing is reserved |
| Any statement fails mid-transaction | `ROLLBACK`; nothing from the transaction is visible; the connection is released |
| Stock set below current reservations | `CHECK` violation; the update is rejected with `500` |
| Refund of an order already shipped or delivered | `400`; only `confirmed` orders can be refunded |
| Cancelling a `confirmed` (paid) order | Order cancelled, stock released, payment marked `refunded` |
| Concurrent `process` calls for one order, on one or several payments | Serialised by the order row lock; at most one payment completes, the others get `400` |
| Two concurrent refreshes with one refresh token | Exactly one succeeds; the other gets `401` |
| A burst of concurrent login attempts | Exactly 5 are admitted; the Lua script makes the check atomic |
| A payment key reused for a different order | `409` |
| The app runs behind a proxy | `trust proxy` is not set, so `req.ip` is the proxy's address and every client shares one limit |
| Redis unreachable | Cached reads, login and register fail with `500`; writes commit in Postgres, then return `500` when cache invalidation fails, so a retried checkout reports `Cart is empty` |
| Kafka unreachable | Each publish waits for a failed connection attempt (2 s timeout, one retry), logs, and continues; requests succeed, slower; events are lost |
| Kafka unreachable at startup | Consumers fail to start, the error is logged, the server keeps serving, and they are not retried |
| Crash between `COMMIT` and publish | The order exists; its event was never sent |
| A cached read races a write | Stale data can be cached for up to the TTL (600 s product, 300 s search) |
| `JWT_SECRET` not set | In production the process refuses to start; elsewhere tokens are signed with `change-me` |
| Anyone registers with `role: admin` | Accepted; there is no approval step |
| Requests to many unknown URLs | All counted under one `route="unmatched"` label |
| Access token of a user who was deactivated or changed role | Keeps working until it expires (up to 15 minutes) |
| `SIGTERM` | The process exits immediately; Postgres rolls back open transactions |
| Uncaught exception | Logged; the process exits with code 1 and relies on a supervisor to restart it |
| Unhandled promise rejection | Logged; the process continues |

---

## 18. Future improvements

In order of expected value, based on §15 and §17.

1. **Outbox for events.** Write each event to a table in the same transaction as the change, and publish from there. No event is lost by a crash or an outage.
2. **Degrade when Redis is down.** Catch cache errors and fall back to Postgres; never fail a committed write because invalidation failed.
3. **Cheaper search invalidation.** A version number in the search key (`search:v{n}:{hash}`), incremented on write, replaces the keyspace scan with one `INCR`.
4. **Reservation expiry.** Release stock held by `pending` orders after a timeout, so unpaid carts cannot hold stock indefinitely.
5. **A returns flow.** Refunds are limited to orders that have not shipped (§11). Shipped and delivered orders need a return that puts stock back into `total_stock` when the goods arrive.
6. **Security hardening.** Hash refresh tokens at rest, stop accepting `role` at registration, and set `trust proxy` for deployment behind a load balancer.
7. **Money as integer cents** end to end.
8. **Graceful shutdown.** Stop accepting connections, finish in-flight requests, disconnect consumers and the producer, and close the pool.
9. **Better measurement.** Size the connection pool from measurements, profile the concurrent checkout ceiling, and run the benchmarks on a separate machine over a real network.

---

## Appendix: interview questions

**How do you stop two customers buying the last unit?**
Checkout locks the inventory rows it will reserve (`SELECT … FOR UPDATE OF i`)
before checking stock. The second checkout waits, then re-reads the row after
the first commits, sees no stock and fails with `400`. A `CHECK` constraint
makes overselling impossible even if the lock were removed.

**Why lock first, then check?**
Checking before locking leaves a window in which another transaction can reserve
the same stock. The check is only meaningful on a row nobody else can change
until you commit.

**Why is this correct under `READ COMMITTED`, not only `SERIALIZABLE`?**
When `FOR UPDATE` has to wait for a row, Postgres returns the newest committed
version once the lock is granted, not the version from the start of the
statement. The stock check therefore sees the previous checkout's reservation.

**How do you avoid deadlocks when carts share products?**
Every checkout locks its inventory rows in `product_id` order, so no two
checkouts can each hold a lock the other needs.

**Why have `reserved_stock` at all?**
Placing an order is not the moment stock leaves. Cancellation and refund must
give it back, and that must not look like restocking. `total_stock` changes only
on delivery; reservations are counted separately.

**What does the transaction guarantee, and what does it not?**
The reservation, order, order lines and emptied cart commit together or not at
all. It does not cover Redis or Kafka: those happen after commit and can fail
independently.

**Why publish events after commit?**
Publishing first could announce an order that a failed commit never created.
After commit, every event describes something that exists. The price is that a
crash between commit and publish loses the event.

**How are payment retries made safe?**
The client sends a `paymentKey` that is unique in the database. A retry finds
the existing row and returns it. A race is settled by the unique constraint. The
amount comes from the order, never the request, so a retry cannot change it.

**Why are access tokens JWTs but refresh tokens not?**
Access tokens are checked on every request, so verifying a signature beats a
database read. Refresh tokens live for days, so they must be revocable, which
means a row that can be deleted.

**What is refresh token rotation?**
Every refresh deletes the old session and issues a new token, so each refresh
token works once and a replay fails.

**Why a sliding window rather than a fixed window for rate limiting?**
A fixed window allows twice the limit across a boundary. A sorted set of
timestamps pruned on every request always counts the last N minutes.

**How is the cache kept consistent?**
Every write that changes a cached product deletes its key and all search keys
after committing. Remaining staleness comes from a read racing a write, bounded
by the TTL.

**Why invalidate every search key instead of the affected ones?**
Knowing which cached result pages contain a product would mean re-running those
queries. Writes are rare, so a cold search cache after a write is cheaper.

**Why `SCAN` instead of `KEYS`?**
`KEYS` blocks single-threaded Redis for the whole scan. `SCAN` works in small
batches. It still visits every key, so it gets slower as the keyspace grows.

**Why `plainto_tsquery`?**
It accepts arbitrary search-box text. `to_tsquery` expects operator syntax and
fails on ordinary punctuation.

**How does a log line deep in a service know the request id?**
`AsyncLocalStorage` binds the id to the async context at the start of the
request, and a Winston format reads it on every log call. Nothing passes it
explicitly.

**Why is the metrics label the route pattern?**
One series per URL would create one series per product id and grow without
bound. The pattern keeps one series per endpoint.

**What happens if Kafka is down?**
Publishing fails fast, is logged and is skipped; requests succeed and the events
are lost. Postgres remains the record.

**What happens if Redis is down?**
Cached reads and the rate-limited auth routes fail, and writes commit but return
errors when invalidation fails. This is the most important resilience gap.

**What happens if a customer double-clicks "Place order"?**
Both requests lock the customer's cart row first, so they run one after the
other. The second sees the cart the first emptied and gets `400 Cart is empty`.
Without that lock, 9 of 10 trials created two orders: the inventory lock alone
does not help, because the waiting request re-reads the inventory rows but not
the cart items.

**How do you stop an order from being paid twice?**
Every payment attempt locks the order row, re-checks that the order is still
`pending`, and moves the payment out of `pending` with a conditional
`UPDATE … WHERE status = 'pending'`. Two attempts on one order therefore run one
at a time, and only the first can confirm it.

**Why must every transaction lock rows in the same order?**
Two transactions that each hold a lock the other needs deadlock. Checkout,
cancellation, refund and delivery all lock inventory rows sorted by
`product_id`, and the order row before the payment row, so no cycle can form.
