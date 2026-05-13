import type { ErrorCode } from './codes';

// Base class for service-layer errors that need a deterministic HTTP mapping.
// The route layer never branches on `instanceof` - the global Hono error
// handler converts any `ServiceError` into a `{ code, message }` envelope.
// New errors only extend a base subclass (BadRequestError, NotFoundError, ...)
// and pass one of the literal `ErrorCode`s; TS rejects typos.

export type ServiceErrorStatus = 400 | 401 | 403 | 404 | 409 | 412 | 502 | 503 | 504;

export class ServiceError extends Error {
  public readonly code: ErrorCode;
  public readonly status: ServiceErrorStatus;

  public constructor(code: ErrorCode, status: ServiceErrorStatus, message?: string) {
    // Without an explicit verbose message, the code doubles as the
    // human-readable string for logs / stack traces.
    super(message ?? code);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}
