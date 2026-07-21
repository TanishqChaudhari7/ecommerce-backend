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
