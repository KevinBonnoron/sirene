import { type ChildProcess, spawn } from 'node:child_process';

/** Best-effort browser launcher. We never block on it because:
 *  - the user might be on a headless server where no `xdg-open` exists
 *  - the device-code flow still works fine if they just copy the URL */
export function tryOpenBrowser(url: string): void {
  const platform = process.platform;
  try {
    let child: ChildProcess;
    if (platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else if (platform === 'win32') {
      // `start` is a cmd.exe builtin, not a standalone binary
      child = spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
    // `spawn` returns asynchronously: ENOENT (binary missing) is reported via
    // an `error` event, not via the surrounding try/catch. Attach a no-op
    // handler so it doesn't crash the CLI as an unhandled error.
    child.on('error', () => {});
    child.unref();
  } catch {
    // Browser launch is decorative; ignore errors and let the user copy the URL.
  }
}
