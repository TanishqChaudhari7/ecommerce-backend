import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  requestId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestId<T>(requestId: string, callback: () => T): T {
  return asyncLocalStorage.run({ requestId }, callback);
}

export function getRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}
