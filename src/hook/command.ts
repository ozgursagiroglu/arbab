// A strict tokenizer for the Bash commands the PreToolUse hook may approve (DESIGN.md §21, Orchestrator approvals).
// It accepts only words whose shell meaning is their literal text; anything else makes the whole command unknown.

export interface Word {
  /** The word's text, quotes removed. */
  value: string;
  quoted: boolean;
}

const UNQUOTED = /^[A-Za-z0-9_@%+=:,./~-]+$/;
// Inside double quotes the shell still expands these; `!` is history expansion in interactive bash and zsh.
const DOUBLE_QUOTED_UNSAFE = /[$`\\!]/;
// Newlines end a command; other control characters have no business in a runner call.
const CONTROL = /[\x00-\x08\x0a-\x1f\x7f]/;

const isSeparator = (c: string | undefined): boolean => c === " " || c === "\t";

/**
 * The words of `command`, separated by spaces or tabs; null when any part is not a plain word, a wholly single-quoted
 * word or a wholly double-quoted word without `$`, backticks, backslashes or `!`.
 */
export function tokenize(command: string): Word[] | null {
  if (CONTROL.test(command)) return null;
  const words: Word[] = [];
  let i = 0;
  while (i < command.length) {
    const c = command[i];
    if (isSeparator(c)) {
      i++;
      continue;
    }
    let end: number;
    let word: Word;
    if (c === "'" || c === '"') {
      const close = command.indexOf(c, i + 1);
      if (close < 0) return null;
      const value = command.slice(i + 1, close);
      if (c === '"' && DOUBLE_QUOTED_UNSAFE.test(value)) return null;
      word = { value, quoted: true };
      end = close + 1;
    } else {
      end = i;
      while (end < command.length && !isSeparator(command[end])) end++;
      const value = command.slice(i, end);
      if (!UNQUOTED.test(value)) return null;
      word = { value, quoted: false };
    }
    // A quote glued to more text (`'a'b`, `"a"'b'`) is a partly quoted word.
    if (end < command.length && !isSeparator(command[end])) return null;
    words.push(word);
    i = end;
  }
  return words;
}

/** `s` as one shell word tokenize() reads back as `s` when it can: bare, else single- or double-quoted. */
export function shellWord(s: string): string {
  if (UNQUOTED.test(s)) return s;
  if (!s.includes("'")) return `'${s}'`;
  return `"${s.replace(/[$`\\!"]/g, "\\$&")}"`;
}
