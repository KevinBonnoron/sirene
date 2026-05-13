/** Minimal ANSI color helpers. Disabled automatically when stdout isn't a TTY
 *  (pipes, redirects, CI) or when `NO_COLOR` is set, per https://no-color.org/.
 *  We don't pull in a chalk-like dep because Bun's --compile bundles every
 *  byte we import - hand-rolled keeps the binary lean. */
const ENABLED = process.stdout.isTTY === true && !process.env.NO_COLOR;

function wrap(code: string): (s: string) => string {
  return (s) => (ENABLED ? `\x1b[${code}m${s}\x1b[0m` : s);
}

export const color = {
  bold: wrap('1'),
  dim: wrap('2'),
  cyan: wrap('36'),
  yellow: wrap('33'),
  green: wrap('32'),
  red: wrap('31'),
};
