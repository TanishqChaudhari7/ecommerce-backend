# Architecture

## Step 1 - Scaffold & Infrastructure

### Files created

| File | Responsibility |
|---|---|
| `tsconfig.json` | Strict-mode TypeScript compiler config for the production build (`src/`, `config/`). |
| `tsconfig.eslint.json` | Extends `tsconfig.json` but also includes `scripts/` and `tests/`, so ESLint's type-aware rules can lint them without those folders being part of the compiled `dist/` output. |
| `.eslintrc.cjs` | ESLint rules (`@typescript-eslint` + `eslint-plugin-prettier`) run against every `.ts` file. |
| `.prettierrc.json` / `.prettierignore` | Formatting rules and paths Prettier skips. |
| `nodemon.json` | Watches `src/` and `config/`, restarts `ts-node src/server.ts` on change (used by `npm run dev`). |
| `jest.config.js` | `ts-jest` preset; test discovery restricted to `tests/**/*.test.ts`. |
| `.env.example` | Documents every environment variable the app reads, with inline comments. |
| `docker-compose.yml` | Local infrastructure: PostgreSQL (5432), Redis (6379), Kafka + Zookeeper (9092), and the app container. |
| `Dockerfile` | Multi-stage build — installs deps and compiles TypeScript in a `builder` stage, then copies only `dist/` + production deps into the final image. |
| `.dockerignore` | Keeps `node_modules`, `dist`, tests, and docs out of the Docker build context. |
| `config/env.ts` | Loads `.env` via `dotenv` and exports a single typed `env` object; every other module reads config through this, never `process.env` directly. |
| `config/logger.ts` | Creates the Winston logger: colorized human-readable output in development, JSON in production. |
| `src/app.ts` | Builds the Express `Application`: JSON body parsing, request logging, `/health`, module routers, error handler. Exported separately from `server.ts` so tests can import `app` without binding a port. |
| `src/server.ts` | Entrypoint — starts the HTTP listener on `env.port` and installs `unhandledRejection` / `uncaughtException` handlers. |
| `src/middleware/requestLogger.ts` | Logs method, path, status code, and duration for every request at the `http` log level once the response finishes. |
| `src/middleware/errorHandler.ts` | Express 4-arg error middleware. Reads `err.statusCode` (defaults to 500), logs the error, and returns a JSON body that omits the stack trace in production. |
| `src/modules/<name>/<name>.routes.ts` | Registers the module's `Router`; currently a single `GET /` wired to the controller. |
| `src/modules/<name>/<name>.controller.ts` | Express request handler; delegates to the service and returns `501 Not Implemented` (placeholder pending later steps). |
| `src/modules/<name>/<name>.service.ts` | Business-logic layer, currently a `ping()` stub. Controllers never talk to the database/cache directly — they always go through a service. |
| `src/modules/<name>/<name>.types.ts` | Module-local TypeScript types/interfaces. |
| `scripts/migrate.ts`, `migrate-rollback.ts`, `seed.ts`, `seed-fresh.ts` | CLI entrypoints run via `ts-node`, invoked by the `npm run migrate*` / `seed*` scripts. Currently log a placeholder message; real DB logic lands in Step 2. |
| `tests/unit/health.test.ts` | Supertest-driven test asserting `/health` returns `status`, `uptime`, `timestamp`. |
| `migrations/`, `seeds/` | Empty (tracked via `.gitkeep`), populated in Step 2. |
| `tests/integration/`, `tests/concurrency/` | Empty (tracked via `.gitkeep`); `npm run test:integration` / `test:concurrency` pass with `--passWithNoTests` until real suites exist. |

### Folder structure

```
config/            Environment loading + logger, shared by src/, scripts/, tests/
migrations/         SQL/migration files (populated in Step 2)
seeds/              Seed data/scripts (populated in Step 2)
scripts/            One-off CLI entrypoints (migrate, seed) run via ts-node
src/
  app.ts            Express app construction (no listening)
  server.ts          Process entrypoint (listens, signal handlers)
  middleware/        Cross-cutting Express middleware
  modules/<name>/    One folder per business domain: controller, service, routes, types
tests/
  unit/              Fast, no external dependencies (jest — `npm test`)
  integration/       Hits real Postgres/Redis/Kafka via docker-compose (`npm run test:integration`)
  concurrency/        Race-condition / load-style tests (`npm run test:concurrency`)
DOCS/                Architecture, run instructions, testing guide, changelog
```

Each module folder is self-contained and has no imports from sibling modules — cross-module logic will be composed at the route/service level in later steps rather than modules importing each other directly.

### Request flow

1. **`src/server.ts`** starts the HTTP server on `env.port`, delegating request handling to the `app` built in `src/app.ts`.
2. **`express.json()`** parses the request body.
3. **`requestLogger`** records the start time and registers a `res.on('finish', ...)` listener that logs method, path, status, and duration once the response is sent.
4. The request is matched against routes in order: `GET /health` first, then each module's router mounted at `/api/v1/<module>` (e.g. `/api/v1/products` → `src/modules/products/products.routes.ts`).
5. A matched module route calls its **controller**, which calls its **service**, and sends the JSON response (currently `501` placeholders for all modules).
6. If a handler throws or calls `next(error)`, Express skips remaining routes and invokes **`errorHandler`**, the last middleware registered in `app.ts`. It logs the error via Winston and responds with a JSON error body (stack trace included only outside production).
7. Whether the response succeeded or errored, the `finish` event fires and `requestLogger` writes the access log line.

### Patterns used

- **Controller → Service separation**: controllers only handle HTTP concerns (parsing req, shaping res, calling `next(error)`); business logic lives in services so it can be unit-tested and reused without an HTTP layer.
- **Centralized config object**: `config/env.ts` is the single source of truth for environment variables; no other file reads `process.env` directly.
- **Structured logging over `console.log`**: all logging goes through the Winston `logger`, so output format (JSON vs. pretty) is controlled centrally by environment.
- **Fail-fast process handlers**: unhandled rejections are logged; uncaught exceptions are logged and the process exits, favoring a container restart over running in a corrupted state.
- **Build/lint split via two tsconfigs**: `tsconfig.json` defines what actually ships (`src/`, `config/`); `tsconfig.eslint.json` widens that only for static analysis, so `scripts/` and `tests/` get full type-aware linting without being bundled into `dist/`.

## Step 2 - Database & Seed

### Tables

| Table | Stores | Why |
|---|---|---|
| `users` | Every account: customers, sellers, and admins, distinguished by `role`. | A single table (not per-role tables) keeps auth/session logic uniform; `role` drives authorization in later steps. |
| `sessions` | Issued refresh tokens per user, with expiry. | Lets refresh tokens be revoked/rotated server-side (delete the row) instead of only relying on JWT expiry. |
| `categories` | Product categories, self-referencing via `parent_id`. | `parent_id` allows an arbitrarily nested category tree (e.g. Electronics → Audio → Headphones) without a separate table. |
| `products` | Product catalog: pricing, ownership, availability, and the full-text `search_vector`. | Core sellable entity; owned by a seller, optionally filed under a category. |
| `inventory` | Stock counts per product: `total_stock`, `reserved_stock`, `low_stock_threshold`. | Split from `products` so stock can be updated/locked independently of catalog metadata (different write patterns/frequency). |
| `shopping_carts` | One active cart per user. | Kept separate from `cart_items` so the cart itself has an identity (and a `created_at`) independent of its contents. |
| `cart_items` | Line items (product + quantity) in a cart. | Many-to-many between carts and products, with quantity as the edge attribute. |
| `orders` | A placed order: owning user, `status`, `total_amount`. | The durable, immutable-once-placed record of a transaction; separate from the cart, which is mutable and pre-purchase. |
| `order_items` | Line items of an order, with `unit_price` captured at order time. | Preserves historical pricing even if `products.price` changes later — orders must never retroactively change value. |
| `payments` | Payment attempts/results against an order, with a unique `payment_key`. | Kept separate from `orders` so an order can have multiple payment attempts (e.g. a failed charge followed by a successful retry) without mutating order state. |

### Key relationships

- `sessions.user_id → users.id` (`CASCADE`): a deleted user's sessions are meaningless and removed with them.
- `products.seller_id → users.id` (`RESTRICT`): a user who owns products can't be hard-deleted, preventing orphaned catalog entries (users are deactivated via `is_active`, not deleted).
- `products.category_id → categories.id` (`SET NULL`): deleting a category shouldn't cascade-delete every product in it; the product just becomes uncategorized.
- `categories.parent_id → categories.id` (`SET NULL`): deleting a parent category promotes its children to top-level rather than deleting them.
- `inventory.product_id → products.id` (`CASCADE`, `UNIQUE`): strict one-to-one — every product has exactly one inventory row, removed when the product is.
- `shopping_carts.user_id → users.id` (`CASCADE`, `UNIQUE`): one cart per user, enforced at the schema level by the `UNIQUE` constraint (not just application logic).
- `cart_items.(cart_id, product_id)` (`UNIQUE`): a product can only appear once per cart; adding it again should update `quantity`, not insert a second row.
- `orders.user_id → users.id` (`RESTRICT`): order history must never disappear because a user record was removed.
- `order_items.product_id → products.id` (`RESTRICT`): historical order lines must survive even if a product is later removed from the catalog.
- `payments.order_id → orders.id` (`CASCADE`) / `payments.user_id → users.id` (`RESTRICT`): a payment has no meaning without its order, but must never silently vanish a user's payment history.

### Indexes

- `products.seller_id`, `products.category_id`: both are used to filter a seller's catalog or browse-by-category — the two most common product list queries.
- `products.search_vector` (GIN): required for `tsvector @@ tsquery` full-text search to run in better than linear time.
- `orders.user_id`: powers "my orders" lookups.
- `orders.status`: powers admin/ops queries like "all pending orders."
- `users.email`, `sessions.refresh_token`, `payments.payment_key`: **not** given a separate explicit index — each already has a `UNIQUE` constraint, and Postgres automatically creates a unique B-tree index to enforce it. Adding another index on the same column would be redundant and just cost extra write overhead.

### Soft delete

`products.is_deleted` is a boolean flag rather than an actual `DELETE`. Application code (added in a later step) will filter `WHERE is_deleted = false` on customer-facing reads. Nothing currently enforces this at the schema level (no view or RLS policy) — it's a convention services must follow — because enforcing it in the schema would block admin/reporting queries that legitimately need to see deleted products (e.g. for historical order line display, since `order_items.product_id` still points at it).

### Inventory reservation (schema-level)

`inventory` tracks `total_stock` and `reserved_stock` separately rather than decrementing `total_stock` directly on purchase:

- **Available stock** = `total_stock - reserved_stock` (computed by the application/queries, not a stored column).
- A `CHECK (reserved_stock >= 0 AND reserved_stock <= total_stock)` constraint makes it impossible for reserved stock to exceed on-hand stock or go negative, regardless of which application code path updates it.
- The intent (implemented in a later step, e.g. when carts/orders are wired up): placing an order increments `reserved_stock`; a completed/shipped order decrements both `total_stock` and `reserved_stock` together; a cancelled order or expired reservation decrements only `reserved_stock`. This lets multiple in-flight carts reserve stock without overselling, while the schema's `CHECK` constraint is the last line of defense against a bug reserving more than is on hand.

### Full-text search (tsvector)

- `products.search_vector` is a plain `tsvector` column (not a `GENERATED ALWAYS AS` column) because the task called for trigger-based maintenance rather than a generated column — this also means backfills/reindexing can use a different `to_tsvector` config later without an `ALTER TABLE ... DROP EXPRESSION` migration.
- `products_search_vector_update()` is a `plpgsql` trigger function that rebuilds the vector from `to_tsvector('english', name || ' ' || brand || ' ' || description)` (nulls coalesced to `''`).
- `products_search_vector_trigger` fires `BEFORE INSERT OR UPDATE ... FOR EACH ROW`, so `search_vector` is always in sync — no application code has to remember to update it.
- A GIN index on `search_vector` makes `WHERE search_vector @@ to_tsquery('english', '...')` queries fast (verified manually: inserting a product and querying `to_tsquery('english', 'wireless & mouse')` correctly matched).

### Seed credentials

| Role | Email | Password |
|---|---|---|
| Admin | `admin@test.com` | `Test@1234` |
| Seller | `seller@test.com` | `Test@1234` |
| Customer | `customer@test.com` | `Test@1234` |

All three share the same bcrypt hash of `Test@1234` (cost factor 10). `npm run seed` is safe to run repeatedly (every insert targets the row's natural unique key with `ON CONFLICT ... DO NOTHING`); `npm run seed:fresh` truncates all 10 tables (`CASCADE`) and reseeds from scratch. Every seeded row uses a deterministic, hardcoded UUID (grouped by table, e.g. all user ids start `00000001-...`) rather than `gen_random_uuid()`, which is what makes reruns idempotent instead of merely conflict-free.

## Step 3 - Auth & RBAC

### Access vs. refresh token strategy

Two tokens with very different shapes, on purpose:

- **Access token** — a signed JWT (`jsonwebtoken`, `HS256` via `env.jwtSecret`) carrying `{ userId, email, role }`, expiring after 15 minutes (`JWT_EXPIRES_IN`). It's stateless: `authenticateToken` only has to verify the signature and expiry, with no database round-trip, which is what makes it cheap to check on every request.
- **Refresh token** — an opaque random string (`crypto.randomBytes(64).toString('hex')`, *not* a JWT), stored server-side in `sessions` (`user_id`, `refresh_token`, `expires_at`), expiring after 7 days (`JWT_REFRESH_EXPIRES_IN`). Because it's just a row in the database, it can be revoked instantly (delete the row) — something a stateless JWT refresh token could not do without an extra denylist.

The short-lived stateless token keeps the hot path (every authenticated request) fast and DB-free; the long-lived stateful token keeps the sensitive, infrequent path (getting a new access token) revocable. Neither token alone gives both properties — that's the reason for two.

### Token rotation flow

`POST /api/v1/auth/refresh` with `{ refreshToken }`:

1. Look up `sessions WHERE refresh_token = $1`. Not found → `401 Invalid refresh token`.
2. Check `session.expires_at` against `now()`. Expired → delete the row anyway (cleanup) and return `401 Refresh token expired`.
3. Load the owning user. Missing or `is_active = false` → delete the session and return `401 User no longer active`.
4. **Delete the old session row unconditionally** before issuing anything new — this is the "rotate" step: the old refresh token becomes unusable the instant it's used, whether or not the request as a whole succeeds past this point.
5. Issue a brand new access token + a brand new opaque refresh token, insert the new session row, return both to the client.

Practical effect: a refresh token is single-use. If it's ever replayed (e.g. stolen and used by an attacker after the legitimate client already rotated it), the second use simply 401s because the row is already gone — the same mechanism that enables rotation also limits the blast radius of a leaked refresh token to a single use.

### RBAC middleware chain

Two independent, composable middlewares, applied in sequence on a route:

```
router.get('/some-protected-route', authenticateToken, requireRole('seller', 'admin'), controller.handler);
```

- **`authenticateToken`**: reads `Authorization: Bearer <token>`, `jwt.verify`s it against `env.jwtSecret`, and on success attaches the decoded payload to `req.user` (typed as `AccessTokenPayload`). Missing header, malformed token, bad signature, or expiry all produce the same `401` — the client can't distinguish "no token" from "bad token" from "expired token," which avoids leaking which case applies.
- **`requireRole(...roles)`**: a factory, not a middleware itself — calling it with a list of allowed roles (e.g. `requireRole('admin')`) returns a middleware that checks `req.user.role` against that list, responding `403` if `req.user` is missing (i.e. `authenticateToken` wasn't run first, or somehow didn't attach a user) or its role isn't allowed.

Splitting these two concerns (authentication vs. authorization) means a route can require login without restricting role (`authenticateToken` alone, as `GET /me` does), or chain both when only specific roles should reach a handler. No route in Step 3 uses `requireRole` yet — the endpoints seeded here (register/login/refresh/logout/me) are either public or "any authenticated user"; role-gated business endpoints (e.g. only sellers creating products) are wired starting Step 4, reusing this same middleware unchanged.

### Redis sliding-window rate limiting

`src/middleware/rateLimiter.ts` implements a true sliding window (not fixed-window buckets) using one Redis **sorted set** per `(route, IP)`, where each member's score is the request's timestamp in milliseconds:

1. `ZREMRANGEBYSCORE key 0 (now - windowMs)` — prune every entry older than the window; this is what makes it "sliding" rather than resetting on a clock boundary.
2. `ZCARD key` — count what's left (i.e. requests within the last `windowMs`).
3. If `count >= max`: read the oldest surviving entry (`ZRANGE key 0 0 WITHSCORES`) to compute exactly when it will age out (`oldestTimestamp + windowMs - now`), set that as the `Retry-After` header (in seconds), and respond `429`.
4. Otherwise: `ZADD key now <unique-member>` to record this request, `PEXPIRE key windowMs` so an abandoned key cleans itself up, and call `next()`.

The member string (`${now}-${random}`) is unique per request even when two requests land in the same millisecond, since sorted set members must be unique — using a bare timestamp as the member would silently collide and undercount. Applied via `rateLimit({ windowMs, max, keyPrefix })`:

- `login`: 5 requests / 15 minutes / IP.
- `register`: 10 requests / hour / IP.

Both limiters count *every* request that reaches the route (successes, wrong-password 401s, and validation 400s alike), because the limiter middleware runs before Zod validation — rate limiting only the "invalid" requests would let an attacker bypass it by sending malformed bodies.

### Security decisions

- **bcrypt cost factor 12** for password hashing — higher than the library default (10) to raise the cost of offline brute-forcing if the `users` table were ever exfiltrated, while still completing in well under 100ms on typical hardware.
- **Access tokens are short-lived (15 min)** specifically so that a leaked access token has a small, fixed window of usefulness, without requiring any server-side revocation mechanism for them.
- **Refresh tokens are opaque, not JWTs** — see "Access vs. refresh token strategy" above; this is what makes instant revocation (logout, rotation) possible.
- **Registration accepts `role` directly from the request body** (defaulting to `customer`) as specified — meaning any caller can currently self-register as `seller` or even `admin`. This is a known, deliberate simplification for this stage of the project (there's no invite/approval flow yet); it should be revisited before this API is exposed publicly (e.g. requiring an existing admin to grant the `seller`/`admin` role instead of trusting client input).
- **`helmet()`** is applied globally and first in the middleware chain, adding the standard protective headers (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Strict-Transport-Security`, etc.) to every response, auth-related or not.
- **`cors()`** is applied with its permissive defaults (reflects any origin) — appropriate for this stage of development; will need an explicit allow-list once there's a known frontend origin to restrict to.
- **Generic auth error messages**: login failures always say "Invalid email or password" regardless of whether the email exists, and `authenticateToken` always says "Invalid or expired access token" regardless of which check failed — both deliberately avoid confirming to an attacker which half of a guess was correct.

### `req.user` typing

`src/types/express.d.ts` uses TypeScript's global augmentation to add `user?: AccessTokenPayload` to Express's own `Request` interface:

```ts
declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}
```

Because this merges into the `Express` namespace globally, every `Request` throughout the app — in any controller, any middleware, any module, without a single extra import — has `req.user` available and correctly typed as `AccessTokenPayload | undefined`, with no casting required. `authenticateToken` is the only place that assigns it; every other consumer (`requireRole`, `authController.me`) only reads it, and the `| undefined` in the type forces every reader to handle the "not authenticated" case rather than assuming a value is always present.

## Step 4 - Products, Inventory & Search

### Full-text search with `plainto_tsquery`

`products.search_vector` (populated by the `BEFORE INSERT OR UPDATE` trigger from Step 2) is a `tsvector` built from `name`, `brand`, and `description`. The search endpoint matches it with:

```sql
WHERE p.search_vector @@ plainto_tsquery('english', $q)
```

`plainto_tsquery` (rather than `to_tsquery` or `websearch_to_tsquery`) was chosen specifically because it takes plain, unstructured user input — spaces, punctuation, anything a search box might receive — and turns it into an `AND`-of-lexemes query without the caller needing to know `tsquery` operator syntax (`&`, `|`, `!`, `<->`). `to_tsquery` would throw a syntax error on input like `"wireless mouse!"`; `plainto_tsquery` just tokenizes, stems (`'english'` config), and ANDs the terms together. The `@@` operator is what the GIN index on `search_vector` (from Step 2) actually accelerates — without it, this would be a sequential scan with a stemming function call per row.

`category`, `minPrice`/`maxPrice`, and `brand` are plain `WHERE` clauses layered on top with `AND` — they narrow the same result set the tsvector match produces, they don't participate in ranking (no `ts_rank` is used; results are explicitly sorted by `sortBy`/`sortOrder` instead, which the task called for over relevance ranking).

### Redis cache-aside pattern

Both `GET /products/:id` and `GET /search` follow the same shape:

1. Compute a deterministic cache key from the request (`product:{id}`, or `search:{md5(canonical query)}`).
2. `GET` that key from Redis. Hit → parse and return the cached JSON directly, no database query at all.
3. Miss → run the real Postgres query, build the response, `SET` it into Redis with an `EX` TTL, then return it.

This is why `PublicProduct.createdAt`/`updatedAt` are typed and stored as ISO **strings**, not `Date` objects: a cache hit returns whatever was `JSON.parse`'d back out of Redis, and a cache miss returns whatever was just built from a fresh DB row. Serializing dates to strings before caching means both paths produce byte-identical shapes — a consumer of this API can't tell, and doesn't need to care, whether a given response came from Postgres or from Redis.

The search cache key is built by taking the *validated* query object (after Zod has applied defaults, e.g. `page=1` when omitted) and running `JSON.stringify(query, Object.keys(query).sort())` before hashing with MD5. Passing the sorted key list as `JSON.stringify`'s replacer argument forces a canonical key order regardless of how the client wrote the query string — `?q=mouse&page=1` and `?page=1&q=mouse` hash to the same cache key, and an unspecified `sortOrder` (defaulted by Zod) doesn't produce a different key than one written explicitly.

### Cache invalidation strategy

- `product:{id}` is deleted directly (single-key `DEL`) whenever that specific product changes: on `PUT`, on soft-`DELETE`, and on an inventory stock update (stock feeds into that product's cached `availableStock`).
- **Every** `search:*` key is deleted — not just keys that might contain the affected product — on product create, product update, soft delete, and inventory update. This is `deleteKeysByPattern('search:*')` in `src/config/redis.ts`, a non-blocking `SCAN`/`MATCH`/`DEL` loop (chosen over the simpler but blocking `KEYS` command, which would stall the single-threaded Redis server for the duration of the scan on a larger keyspace).
- The reason it's "delete everything matching `search:*`" rather than "figure out which cached searches contain this product": a cached search result is a full page of products plus a total count, produced by an arbitrary combination of `q`/`category`/`price range`/`brand`/`sort`/`page`. There is no cheap way to know, after the fact, which of those cached combinations a single changed product would have appeared in (or affected the `total` count of) without re-running every cached query — which defeats the purpose of caching. Given the search cache's short 5-minute TTL and that writes (create/update/delete) are comparatively rare next to reads, blanket invalidation trades a brief cache-cold period after any write for correctness, which is the right tradeoff here: serving stale search results (an out-of-stock item still listed, a changed price) is a worse failure mode than a few extra cache misses.

### Available stock and `reserved_stock`

`availableStock` in every product response is computed as `total_stock - reserved_stock`, always at read time (it is never itself stored) — `total_stock` and `reserved_stock` are the columns that change; `availableStock` is a derived view over them.

`reserved_stock` exists as a separate column (rather than decrementing `total_stock` directly whenever something is purchased) because a purchase is a multi-step process — item added to cart, checked out, payment pending, payment confirmed — and stock has to be held for a customer partway through that process without yet being permanently subtracted from what's physically on hand. Step 2's schema already anticipated this: a `CHECK (reserved_stock >= 0 AND reserved_stock <= total_stock)` constraint prevents reserved stock from ever exceeding on-hand stock, no matter which code path updates it. This step only wires up the read side (`availableStock`) and the seller/admin-facing `total_stock` update; the reservation lifecycle itself (incrementing `reserved_stock` on order placement, decrementing both together on fulfillment) is Step 5's concern (Cart, Orders, Payments), once there's an order flow to drive it.

### Soft delete enforcement

Every product-reading query in this step — `listProducts`, `getProductById`, `findOwnableProduct` (used by update/delete ownership checks), the search query, and the inventory low-stock query — includes `p.is_deleted = false` (or, for `findOwnableProduct`, is used specifically so a soft-deleted product can no longer be updated/deleted at all, returning `404` as if it didn't exist). There's no single shared query builder enforcing this centrally; instead every hand-written SQL statement that touches `products` repeats the same literal condition. The `product:{id}` and `search:*` Redis caches only ever get populated from these already-filtered queries, so a soft-deleted product also can't "leak" back into visibility through the cache — but only because delete also explicitly invalidates both caches (see "Cache invalidation strategy" above); without that, a deleted product already sitting in cache could keep being served as available for up to its remaining TTL.

### Kafka producer setup and `publishEvent`

`src/config/kafka.ts` constructs a single `kafkajs` `Producer` at module load (`kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner })`) but does **not** connect immediately — constructing a `Kafka`/`Producer` instance doesn't open a socket, so importing this module (transitively, via `app.ts` → the products/inventory routes) has no side effect and can't leave an open handle in, say, a test run that never actually publishes anything.

`publishEvent(topic, payload)` is the only way the rest of the app talks to Kafka:

1. Lazily connects the producer on first call (`ensureConnected()`, a one-time `producer.connect()` guarded by a module-level `connected` flag).
2. `JSON.stringify`s the payload and sends it as a single message to `topic`.
3. Catches and **logs** (via the existing Winston logger) rather than rethrows any failure.

That third point is deliberate: publishing `product.updated`/`inventory.updated` is a side effect of a successful database write, not a precondition for the client's request to succeed. If Kafka is briefly unreachable, a seller updating their product price should still get their `200 OK` — losing an event to a transient broker outage is an acceptable tradeoff for this system's current scope (there's no outbox pattern / guaranteed-delivery requirement yet), versus failing an otherwise-successful product update because a downstream system happened to be down.

Two topics are published today, both from service methods after their triggering write has already committed:
- `product.updated` — from `ProductsService.updateProduct`, `{ productId, sellerId, updatedAt }`.
- `inventory.updated` — from `InventoryService.updateStock`, but **only** when the update leaves `available_stock <= low_stock_threshold`; it carries the full stock snapshot (`{ productId, totalStock, reservedStock, availableStock, lowStockThreshold }`) so a consumer doesn't need to re-query the product to decide whether to act (e.g. notify the seller, trigger reordering).

Verified against a real local Kafka broker (KRaft mode, no ZooKeeper) with a `kafka-console-consumer` running against both topics: updating a product produced exactly one `product.updated` message with the expected fields; dropping a product's stock to or below its threshold produced an `inventory.updated` message, while a stock update that stayed above the threshold correctly produced none.

## Step 5 - Cart, Orders, Payments & Kafka

### Order placement transaction, step by step

`OrdersService.placeOrder` runs as a single `pg` client transaction (one connection, explicit `BEGIN`/`COMMIT`/`ROLLBACK` — not `pool.query`, which would use a different connection per call and couldn't share a transaction):

1. **`BEGIN`.**
2. **Find the customer's cart.** No cart row → `400 Cart is empty`. This has to come before anything else touches inventory: there's nothing to reserve stock for yet.
3. **Read and lock every cart item's product + inventory row (`SELECT ... FOR UPDATE OF i`).** The lock is taken here, before any validation, because validation itself ("is there enough stock?") is only meaningful against a row nobody else can concurrently change out from under it. Locking after validating would defeat the point — a second transaction could slip in between the check and the lock.
4. **Validate every item:** `is_available` and `quantity <= available_stock` (`total_stock - reserved_stock`, read from the just-locked rows). Any single item failing throws immediately, which unwinds to the `catch` block and rolls back — so a cart with 3 valid items and 1 invalid one reserves nothing for the 3 valid ones either. All-or-nothing was chosen over "reserve what you can" because a partially-fulfilled order is a worse customer experience than a clear "your order couldn't be placed" — and it's what makes the rest of the transaction (a single order with a single consistent total) meaningful.
5. **Reserve stock**: `UPDATE inventory SET reserved_stock = reserved_stock + quantity` for each item, while still holding the locks from step 3. This is safe precisely because of that lock — no other transaction can be mid-read of the same inventory rows right now.
6. **Insert the order** (`status = 'pending'`, `total_amount` computed from the locked items' prices — never from client input).
7. **Insert `order_items`**, one row per cart item, snapshotting `unit_price` at order time (so a later price change on the product never retroactively changes what this order billed).
8. **Delete the cart's `cart_items`.** The cart is now "spent" — its contents have become an order.
9. **`COMMIT`.**
10. *(Outside the transaction, after commit)* invalidate the affected products' `product:{id}`/`search:*` caches (reservation changed `availableStock`), then `publishEvent('order.created', ...)`.

**Deliberate deviation from the task's literal step numbering**: the task listed "7. Publish order.created ... 8. COMMIT" — publish *before* commit. This implementation commits first, then publishes. Publishing before a commit that might still fail (rare, but possible — e.g. a connection drop right before `COMMIT` lands) would mean announcing an order to every Kafka consumer (including the audit log) that doesn't actually exist in the database once the dust settles. Since `publishEvent` never throws (Step 4), there's no correctness reason to publish early, and committing first guarantees every `order.created` event corresponds to a real, durable order.

### Why `reserved_stock` instead of decrementing `total_stock` immediately

This was already set up schema-wise in Step 2 and used read-only in Step 4; Step 5 is where it actually gets exercised end-to-end. The short version: **placing an order is not the same moment as the stock physically leaving the warehouse.** Between "order placed" and "order delivered," a customer can cancel, a payment can fail, an admin can refund — all of which need to give the stock back. If `total_stock` were decremented at order time, "giving it back" would mean incrementing `total_stock` again, which is indistinguishable from *new* stock arriving — there'd be no way to tell "this unit came back because an order was cancelled" from "the seller restocked." Keeping a separate `reserved_stock` counter means:

- `total_stock` only ever changes when stock actually, physically changes (seller restocks it, or an order is `delivered` and the unit is genuinely gone).
- `reserved_stock` tracks "spoken for but not yet gone" — incremented on order placement, decremented on cancel/refund, and **converted** into a `total_stock` decrease (both drop together) only at `delivered`, the one point where reservation becomes physical fact.
- `availableStock = total_stock - reserved_stock` is always derivable and never needs its own column or its own invalidation logic beyond the two inputs it's built from.

### Idempotent payment key pattern

`payment_key` is a caller-supplied idempotency token (not server-generated) with a `UNIQUE` constraint backing it since Step 2. `POST /payments/initiate` always checks for an existing row with that key *before* creating anything:

- **First call**, `paymentKey = "abc"`: no existing row → validates the order, inserts a new `pending` payment, returns it with `201`.
- **Retry** (e.g. the client's HTTP response was lost to a network blip, so it retries the exact same request with the exact same `paymentKey = "abc"`): existing row found → returned as-is with `200`. No second payment row, no double-charge risk, no error — the retry is indistinguishable in effect from the request having simply taken a bit longer.
- **Race** (two requests with a brand-new key arrive close enough together that both pass the "no existing row" check before either inserts): the second `INSERT` hits the `UNIQUE` constraint and fails; the `catch` block detects the Postgres unique-violation code and re-reads the row the *other* request just inserted, returning that instead of propagating a `500`. The database's own constraint is the actual source of truth for uniqueness; the earlier `SELECT` is just an optimization to skip the round-trip in the common (non-racing) case.

This is why `amount` on the payment is always derived from `orders.total_amount` server-side rather than accepted from the request body: the whole point of an idempotency key is that retrying is safe *because* retrying can't change what actually happens — that guarantee breaks if a client could smuggle in a different amount on a "retry."

### Order status lifecycle

```
pending → confirmed → shipped → delivered
   ↓           ↓
cancelled   cancelled
```

- **`pending`**: set by `placeOrder`. Stock is reserved; nothing has been paid yet.
- **`pending → confirmed`**: triggered by `PaymentsService.process` succeeding (the mocked 90% path) — *not* by the admin status endpoint. A payment completing is what confirms an order; there's no other way to reach `confirmed`.
- **`confirmed → shipped`**, **`shipped → delivered`**: triggered only by an admin calling `PUT /orders/:id/status`. `ALLOWED_TRANSITIONS` is a strict one-step lookup table (`{ pending: 'confirmed', confirmed: 'shipped', shipped: 'delivered' }`); any requested status that isn't exactly the current status's single allowed successor is rejected with `400` — so `pending → shipped` or `confirmed → confirmed` both fail, not just the "backwards" transitions.
- **`delivered`**: the terminal success state. This is the one status change with an extra side effect — `total_stock` and `reserved_stock` both decrement together, because this is the moment a reservation becomes a permanent, physical stock reduction.
- **`pending`/`confirmed → cancelled`**: triggered by the customer calling `PUT /orders/:id/cancel` (only legal from these two statuses — once `shipped`, the physical item is already in transit and cancelling stops making sense as a simple stock-release operation) or by an admin refunding a `completed` payment (`PaymentsService.refund`, which cancels the order as part of the same transaction as the refund).
- **`cancelled`** and **`delivered`** are both terminal — nothing in this codebase transitions an order out of either.

### How `ROLLBACK` works when something fails mid-transaction

Every multi-statement write in this step (`placeOrder`, `cancelOrder`, `updateStatus`, the success path of `process`, `refund`) follows the same shape:

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // ... multiple client.query() calls, any of which can throw ...
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

If any statement between `BEGIN` and `COMMIT` throws — a validation `AppError` thrown deliberately by application code (e.g. "insufficient stock"), or a genuine Postgres error (e.g. a `CHECK` constraint violation) — control jumps straight to `catch`, which issues `ROLLBACK` on that same connection before re-throwing. Postgres discards every change made since `BEGIN` as a unit; from any other connection's point of view, it's as if none of the statements in that transaction ever ran. `finally` always releases the connection back to the pool regardless of which path was taken, so a failed transaction doesn't leak a connection. This is what the live concurrency test relied on: when the second of two simultaneous `placeOrder` calls found (after acquiring its `FOR UPDATE` lock) that stock was already exhausted by the first, it threw, rolled back, and left `reserved_stock` exactly as the first transaction's commit had left it — no partial reservation, no phantom order row.

### Kafka consumer design

`src/consumers/index.ts` exports a single `startConsumers()`, called once from `server.ts` (deliberately not from `app.ts` — the health-check unit test imports `app`, and doing this there would mean every test run tries to join real Kafka consumer groups).

- **AuditConsumer** (`groupId: 'audit-consumer'`) subscribes to `Object.values(KAFKA_TOPICS)` — every topic the system currently defines, with no per-topic logic — and logs `[AUDIT] {timestamp} | topic: {topic} | payload: {json}` for each message. Its only job is a complete, human-readable record of everything that happened; if a new topic is added to `KAFKA_TOPICS` in `src/config/kafka.ts`, the audit consumer picks it up automatically with no code change.
- **InventoryConsumer** (`groupId: 'inventory-consumer'`) subscribes only to `order.cancelled` and is the one consumer that actually changes state. Because `OrdersService.cancelOrder` *already* releases `reserved_stock` synchronously in its own transaction (see the lifecycle section above) before publishing the event, this consumer would double-decrement on every single cancellation if it just blindly repeated that work. It doesn't: both the synchronous handler and the consumer race to claim the same Redis key (`order:stock-released:{orderId}`) via `SET ... NX`, and only the side that wins the claim performs the decrement. In practice the synchronous handler always wins (it claims the key, *then* publishes — so the event literally cannot reach the consumer before the key exists), making the consumer's own decrement path a safety net for scenarios outside this codebase's current scope (e.g. a future service publishing `order.cancelled` directly without going through this HTTP endpoint) rather than something that fires on the normal path. Verified live: cancelling an order produces the audit log line *and* a separate "Reserved stock already released for order ..., skipping" log line from the InventoryConsumer, confirming the guard — not the decrement — is what actually runs.
- As a second layer of defense independent of the Redis guard, `inventory.reserved_stock` still carries its Step 2 `CHECK (reserved_stock >= 0)` constraint, and the consumer's own decrement uses `GREATEST(reserved_stock - quantity, 0)` rather than a bare subtraction — so even in a hypothetical scenario where the Redis marker was lost (e.g. a Redis restart wiping the key), a duplicate release can't drive the column negative.
