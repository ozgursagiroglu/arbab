// The connection pill and what the page says when its stream closes (DESIGN.md §19).
import { TOKENS } from "./tokens";

export const CLOSED_MESSAGE = "This session ended or restarted. Use the tab the new `arbab ui` opened, or the URL it printed.";
export const TOO_MANY_MESSAGE = "This page is one too many: arbab ui serves 16 at once. Close another of its tabs and reload.";
export const NOT_RUNNING_MESSAGE = "arbab ui is not running.";

/**
 * Why the stream closed, from a fetch of the snapshot route with the same token: 200 means the server is up and the
 * token good, so it refused the stream for its client limit; 401 means another session; no answer means no server.
 * `null` is a fetch that failed.
 */
export function closedMessage(probe: { status: number } | null): string {
  if (probe === null) return NOT_RUNNING_MESSAGE;
  return probe.status === 200 ? TOO_MANY_MESSAGE : CLOSED_MESSAGE;
}

export type Connection = "connecting" | "live" | "lost" | "closed";

export function connectionLabel(state: Connection): { text: string; color: string } {
  switch (state) {
    case "live":
      return { text: "LIVE", color: TOKENS["st-success"] };
    case "lost":
      return { text: "RECONNECTING", color: TOKENS["st-waiting"] };
    case "closed":
      return { text: "OFFLINE", color: TOKENS["st-failed"] };
    default:
      return { text: "CONNECTING", color: TOKENS.muted };
  }
}
