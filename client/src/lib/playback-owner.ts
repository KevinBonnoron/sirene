type StopFn = () => void;

let current: StopFn | null = null;

// One sound at a time across the app. The studio can start a stream while a take is
// playing, and the two use different engines, so the exclusivity cannot live in either.
export function claimPlayback(stop: StopFn): void {
  if (current && current !== stop) {
    current();
  }
  current = stop;
}

export function releasePlayback(stop: StopFn): void {
  if (current === stop) {
    current = null;
  }
}

export function stopPlayback(): void {
  if (current) {
    const stop = current;
    current = null;
    stop();
  }
}
