// Anything outside these characters may mean something to the shell (`;`, `|`, `$`, `*`, …), so it is quoted. The
// empty argument is quoted too, so that it survives the round trip.
const NEEDS_QUOTES = /[^A-Za-z0-9_./:@%+=,-]|^$/;

/**
 * The argv as one command line, POSIX-quoted only where needed, so every argument stays one literal word. The same
 * text goes into a brief, an allow rule and a stream lookup (verify's gates, arbab-check's commands), so they agree.
 */
export function commandLine(argv: string[]): string {
  return argv.map((arg) => (NEEDS_QUOTES.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg)).join(" ");
}
