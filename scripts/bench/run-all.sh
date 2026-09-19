#!/usr/bin/env bash
# Runs every benchmark against a production build and writes the raw output, plus the
# machine and software versions, to scripts/bench/results/. One-off experiments in
# results/one-off/ are kept; everything else in results/ is regenerated.
#
#   npm run bench            (RUNS=3 by default; RUNS=5 npm run bench for more)
#
# Needs Postgres and Redis from .env to be running, and nothing else on PORT (default
# 3000). Benchmarks write fixtures to the DATABASE_URL database and delete them after.
set -euo pipefail

cd "$(dirname "$0")/../.."
OUT=scripts/bench/results
RUNS=${RUNS:-3}
PORT=${PORT:-3000}
export API_BASE_URL="http://localhost:${PORT}"

if curl -sf "${API_BASE_URL}/health" >/dev/null 2>&1; then
  echo "Something is already serving ${API_BASE_URL}; stop it first so the benchmark measures a fresh production build." >&2
  exit 1
fi

npm run build >/dev/null
mkdir -p "$OUT"
rm -f "$OUT"/*.txt "$OUT"/*.json

{
  echo "date: $(date -u +%FT%TZ)"
  echo "commit: $(git rev-parse --short HEAD)"
  echo "uncommitted changes: $(git status --porcelain -- src config seeds migrations | wc -l | tr -d ' ') files"
  if [[ "$(uname)" == "Darwin" ]]; then
    echo "cpu: $(sysctl -n machdep.cpu.brand_string), $(sysctl -n hw.ncpu) cores"
    echo "memory: $(($(sysctl -n hw.memsize) / 1073741824)) GB"
    echo "os: macOS $(sw_vers -productVersion)"
  else
    echo "cpu: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs), $(nproc) cores"
    echo "memory: $(($(grep MemTotal /proc/meminfo | awk '{print $2}') / 1048576)) GB"
    echo "os: $(uname -sr)"
  fi
  echo "node: $(node -v)"
  npx ts-node -e "
    import { pool } from './src/config/db';
    import { redis } from './src/config/redis';
    (async () => {
      const pg = await pool.query('SHOW server_version');
      const info = await redis.info('server');
      console.log('postgres: ' + pg.rows[0].server_version);
      console.log('redis: ' + (info.match(/redis_version:(\S+)/) ?? [])[1]);
      await pool.end();
      await redis.quit();
    })();"
  echo "load average at start: $(uptime | sed 's/.*load averages*: //')"
  echo "runs of cache.ts and throughput.ts: ${RUNS}"
} > "$OUT/environment.txt"

NODE_ENV=production LOG_LEVEL=error PORT="$PORT" node dist/src/server.js > "$OUT/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -sf "${API_BASE_URL}/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf "${API_BASE_URL}/health" >/dev/null || { echo "server did not start; see $OUT/server.log" >&2; exit 1; }

bench() {
  echo "== $1 $2" >&2
  npx ts-node "scripts/bench/$1.ts" "${@:3}" > "$OUT/$2.txt" 2>&1
}

bench oversell oversell
bench deadlock deadlock
bench checkout checkout run
bench double-submit double-submit
for run in $(seq 1 "$RUNS"); do
  bench cache "cache-run${run}"
  bench throughput "throughput-run${run}"
done

rm -f "$OUT/server.log"
echo "results written to $OUT/" >&2
