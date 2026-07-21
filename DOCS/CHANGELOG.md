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

## [Step 4] - Products, Inventory & Search

## [Step 5] - Cart, Orders, Payments & Kafka

## [Step 6] - Tests, Observability & CI
