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
