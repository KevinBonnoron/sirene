import { type ChildProcess, spawn } from 'node:child_process';

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
    // spawn reports ENOENT via the error event, not the surrounding try/catch
    child.on('error', () => {});
    child.unref();
  } catch {}
}
