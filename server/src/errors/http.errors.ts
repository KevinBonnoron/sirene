import type { ErrorCode } from './codes';
import { ServiceError } from './service.error';

// Generic HTTP-status-shaped errors. Throw sites pass an `ErrorCode` literal,
// not a free-form string - TS won't compile a typo. The optional `message` is
// a verbose English fallback kept around for logs and as the client-side
// default when no translation exists for the code.

export class BadRequestError extends ServiceError {
  public constructor(code: ErrorCode, message?: string) {
    super(code, 400, message);
  }
}

export class UnauthorizedError extends ServiceError {
  public constructor(code: ErrorCode, message?: string) {
    super(code, 401, message);
  }
}

export class NotFoundError extends ServiceError {
  public constructor(code: ErrorCode, message?: string) {
    super(code, 404, message);
  }
}

export class ConflictError extends ServiceError {
  public constructor(code: ErrorCode, message?: string) {
    super(code, 409, message);
  }
}

/** External upstream returned a non-OK response or was unreachable. */
export class UpstreamError extends ServiceError {
  public constructor(code: ErrorCode, message?: string) {
    super(code, 502, message);
  }
}

/** No usable downstream worker - e.g. every inference server is offline. */
export class ServiceUnavailableError extends ServiceError {
  public constructor(code: ErrorCode, message?: string) {
    super(code, 503, message);
  }
}

export class GatewayTimeoutError extends ServiceError {
  public constructor(code: ErrorCode, message?: string) {
    super(code, 504, message);
  }
}
