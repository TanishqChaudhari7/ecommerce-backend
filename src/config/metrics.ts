import client from 'prom-client';

export const register = new client.Registry();

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  registers: [register],
});

export const cacheHitsTotal = new client.Counter({
  name: 'cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['key_pattern'],
  registers: [register],
});

export const cacheMissesTotal = new client.Counter({
  name: 'cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['key_pattern'],
  registers: [register],
});

export const kafkaEventsPublishedTotal = new client.Counter({
  name: 'kafka_events_published_total',
  help: 'Total number of Kafka events published',
  labelNames: ['topic'],
  registers: [register],
});
