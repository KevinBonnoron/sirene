export function readLine(prompt: string, hidden = false): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    if (hidden && stdin.isTTY) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.setEncoding('utf8');

    let buffer = '';
    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (hidden && stdin.isTTY) {
        stdin.setRawMode(false);
      }
      stdin.pause();
    };

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (ch === '\n' || ch === '\r') {
          cleanup();
          if (hidden) {
            process.stdout.write('\n');
          }
          resolve(buffer);
          return;
        }

        if (code === 3) {
          cleanup();
          if (hidden) {
            process.stdout.write('\n');
          }
          reject(new Error('cancelled'));
          return;
        }
        if (code === 127 || code === 8) {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            if (hidden) {
              process.stdout.write('\b \b');
            }
          }

          continue;
        }

        buffer += ch;
        if (hidden) {
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}
