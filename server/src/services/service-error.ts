// Base class for service-layer errors that need a deterministic HTTP mapping.
// The route layer never branches on `instanceof` — it calls `mapServiceError`
// which reads `.status` and `.message` to build the standard `{ message }`
// envelope. New errors only have to extend `ServiceError` with the right
// status; the route layer doesn't need to know about them.

export type ServiceErrorStatus = 400 | 401 | 403 | 404 | 409 | 412 | 502 | 503;

export class ServiceError extends Error {
  public readonly status: ServiceErrorStatus;

  public constructor(message: string, status: ServiceErrorStatus) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

export class BadRequestError extends ServiceError {
  public constructor(message: string) {
    super(message, 400);
  }
}

export class UnauthorizedError extends ServiceError {
  public constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends ServiceError {
  public constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

export class NotFoundError extends ServiceError {
  public constructor(message: string) {
    super(message, 404);
  }
}

export class ConflictError extends ServiceError {
  public constructor(message: string) {
    super(message, 409);
  }
}

/** External upstream returned a non-OK response or was unreachable. */
export class UpstreamError extends ServiceError {
  public constructor(message: string) {
    super(message, 502);
  }
}

/** No usable downstream worker — e.g. every inference server is offline. */
export class ServiceUnavailableError extends ServiceError {
  public constructor(message: string) {
    super(message, 503);
  }
}

interface MappedError {
  status: ServiceErrorStatus | 500;
  body: { message: string };
}

/** Translate a thrown value into a `(status, body)` tuple the route layer can
 *  hand straight to Hono's `c.json(body, status)`. Anything that isn't a
 *  `ServiceError` collapses to 500 with a generic message — domain code should
 *  always raise a typed error so the HTTP shape is intentional. */
export function mapServiceError(err: unknown): MappedError {
  if (err instanceof ServiceError) {
    return { status: err.status, body: { message: err.message } };
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  return { status: 500, body: { message } };
}
