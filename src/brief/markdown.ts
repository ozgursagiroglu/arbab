// Just enough Markdown structure for briefs: fenced code blocks and inline code spans (CommonMark rules, simplified).

export interface MarkdownLine {
  text: string;
  /** Inside a fenced code block, delimiters included. */
  inFence: boolean;
  /** The opening or closing ``` / ~~~ line itself. */
  delimiter: boolean;
  /** The fence's info word (e.g. "sh"), "" when none; null outside fences. */
  info: string | null;
}

const OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

export function scanLines(markdown: string): MarkdownLine[] {
  const out: MarkdownLine[] = [];
  let fence: { char: string; length: number; info: string } | null = null;
  for (const text of markdown.split(/\r?\n/)) {
    if (fence === null) {
      const m = OPEN.exec(text);
      const run = m?.[1];
      const rest = m?.[2] ?? "";
      // A backtick fence's info string cannot contain a backtick (that line is inline code instead).
      if (run !== undefined && !(run.startsWith("`") && rest.includes("`"))) {
        fence = { char: run.charAt(0), length: run.length, info: rest.trim().split(/\s+/)[0] ?? "" };
        out.push({ text, inFence: true, delimiter: true, info: fence.info });
      } else {
        out.push({ text, inFence: false, delimiter: false, info: null });
      }
      continue;
    }
    const run = CLOSE.exec(text)?.[1];
    if (run !== undefined && run.charAt(0) === fence.char && run.length >= fence.length) {
      out.push({ text, inFence: true, delimiter: true, info: fence.info });
      fence = null;
    } else {
      out.push({ text, inFence: true, delimiter: false, info: fence.info });
    }
  }
  return out;
}

/** The contents of the inline code spans on one line: a run of n backticks closes at the next run of exactly n. */
export function inlineCodeSpans(line: string): string[] {
  const spans: string[] = [];
  const runs = [...line.matchAll(/`+/g)];
  let i = 0;
  while (i < runs.length) {
    const open = runs[i];
    if (open === undefined) break;
    let j = i + 1;
    while (j < runs.length && runs[j]?.[0].length !== open[0].length) j++;
    const close = runs[j];
    if (close === undefined) {
      i++;
      continue;
    }
    spans.push(line.slice(open.index + open[0].length, close.index));
    i = j + 1;
  }
  return spans;
}
