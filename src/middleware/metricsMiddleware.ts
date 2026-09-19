import { Request, Response, NextFunction } from 'express';
import { httpRequestsTotal, httpRequestDurationSeconds } from '../config/metrics';

// Both `req.baseUrl` and `req.params` get reset by Express as soon as an error
// propagates back out of a nested router (e.g. via next(error) reaching the
// top-level error handler), so neither can be trusted here for error responses.
// `req.route.path` (the locally-matched pattern, e.g. "/:id") and `req.originalUrl`
// (the real path actually requested) both survive untouched, so the full mounted
// pattern can be reconstructed by stripping as many trailing segments off
// `originalUrl` as `route.path` has, then appending `route.path` back on.
function getRoutePattern(req: Request): string {
  // Unmatched requests share one label: using the raw path would create a new time
  // series for every distinct unknown URL anyone sends.
  if (!req.route) {
    return 'unmatched';
  }

  const fullPath = req.originalUrl.split('?')[0];
  const fullSegments = fullPath.split('/').filter(Boolean);
  const routeSegmentCount = req.route.path.split('/').filter(Boolean).length;
  const prefixSegments = fullSegments.slice(0, fullSegments.length - routeSegmentCount);
  const prefix = prefixSegments.length > 0 ? `/${prefixSegments.join('/')}` : '';
  const suffix = req.route.path === '/' ? '' : req.route.path;

  return `${prefix}${suffix}` || '/';
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const route = getRoutePattern(req);
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;

    httpRequestsTotal.inc({ method: req.method, route, status_code: res.statusCode.toString() });
    httpRequestDurationSeconds.observe({ method: req.method, route }, durationSeconds);
  });

  next();
}
