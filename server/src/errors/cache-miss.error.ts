/** Sentinel raised on HTTP 412 from the inference worker's `/generate{,/stream}`:
 *  the worker rejected the request because we sent a `referenceCacheKey` it
 *  doesn't have. The caller is expected to retry with full `referenceAudioData`.
 *  Not a `ServiceError` because it's caught & handled internally before any
 *  HTTP envelope is built. */
export class CacheMissError extends Error {
  public constructor() {
    super('Reference audio cache miss');
    this.name = 'CacheMissError';
  }
}
