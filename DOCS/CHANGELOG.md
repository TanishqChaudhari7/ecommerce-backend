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

## [Step 3] - Auth & RBAC

## [Step 4] - Products, Inventory & Search

## [Step 5] - Cart, Orders, Payments & Kafka

## [Step 6] - Tests, Observability & CI
