// The `arbab ui` server (DESIGN.md §19): read-only, on 127.0.0.1 only. The page and its assets are public code; the
// data routes need the session token. Every request passes the same checks, in the same order, before it is routed.
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ArbabError } from "../../util/errors";
import { UI_EVENTS, UI_ROUTES, UI_TOKEN_PARAM } from "../protocol";
import type { UiAssets, UiSnapshot } from "../protocol";

export interface UiServerOptions {
  /** 0: the system picks a free port. */
  port: number;
  token: string;
  assets: UiAssets;
  /** Called at most once per tick, and only while a client listens. */
  snapshot: () => UiSnapshot;
  /** Default 1000. */
  tickMs?: number;
  /** A snapshot is sent at least this often, changed or not. Default 30000. */
  heartbeatMs?: number;
  /** Default 16. */
  maxClients?: number;
}

export interface UiServer {
  /** http://127.0.0.1:<port>/#token=<token> */
  url: string;
  port: number;
  /** Ends every event stream, closes every connection and stops listening. */
  close(): Promise<void>;
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; " +
    "form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export const MAX_URL_LENGTH = 2048;
/** Builds that throw in a row before the page is told. */
const FAILURES_BEFORE_PROBLEM = 3;
const PROBLEM_MAX = 200;
/** A client this far behind is not reading; it is dropped rather than buffered without bound. */
const MAX_BUFFERED = 4 * 1024 * 1024;

const TEXT = "text/plain; charset=utf-8";

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The snapshot's JSON with `now` left out: what "changed" compares. */
function comparable(snapshot: UiSnapshot): string {
  const { now: _now, ...rest } = snapshot;
  return JSON.stringify(rest);
}

export function startUiServer(options: UiServerOptions): Promise<UiServer> {
  const tickMs = options.tickMs ?? 1000;
  const heartbeatTicks = Math.max(1, Math.ceil((options.heartbeatMs ?? 30_000) / tickMs));
  const maxClients = options.maxClients ?? 16;
  const token = Buffer.from(options.token);
  let port = options.port;

  const clients = new Set<ServerResponse>();
  let timer: NodeJS.Timeout | null = null;
  /** The newest snapshot built (a new client gets it at once), the last one sent, and the ticks since. */
  let latest: string | null = null;
  let lastSent: string | null = null;
  let ticksSinceSent = 0;
  let failures = 0;
  let problemSent = false;

  const send = (res: ServerResponse, event: string, data: string): void => {
    res.write(`event: ${event}\ndata: ${data}\n\n`);
    if (res.writableLength > MAX_BUFFERED) res.destroy();
  };
  const broadcast = (event: string, data: string): void => {
    for (const res of clients) send(res, event, data);
  };

  function tick(): void {
    let snapshot: UiSnapshot;
    try {
      snapshot = options.snapshot();
    } catch (err) {
      failures++;
      if (failures >= FAILURES_BEFORE_PROBLEM && !problemSent) {
        problemSent = true;
        broadcast(UI_EVENTS.problem, JSON.stringify({ message: message(err).slice(0, PROBLEM_MAX) }));
      }
      return;
    }
    failures = 0;
    problemSent = false;
    latest = JSON.stringify(snapshot);
    const key = comparable(snapshot);
    ticksSinceSent++;
    if (key !== lastSent || ticksSinceSent >= heartbeatTicks) {
      lastSent = key;
      ticksSinceSent = 0;
      broadcast(UI_EVENTS.snapshot, latest);
    }
  }

  function stopTicking(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
    latest = null;
    lastSent = null;
    ticksSinceSent = 0;
    failures = 0;
    problemSent = false;
  }

  function reply(req: IncomingMessage, res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}): void {
    res.writeHead(status, { ...SECURITY_HEADERS, ...extra, "Content-Type": type, "Content-Length": String(Buffer.byteLength(body)) });
    res.end(req.method === "HEAD" ? undefined : body);
  }

  function tokenMatches(query: URLSearchParams): boolean {
    const given = query.get(UI_TOKEN_PARAM);
    if (given === null) return false;
    const bytes = Buffer.from(given);
    return bytes.length === token.length && timingSafeEqual(bytes, token);
  }

  function openEvents(req: IncomingMessage, res: ServerResponse): void {
    if (clients.size >= maxClients) {
      reply(req, res, 503, TEXT, "too many clients\n");
      return;
    }
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.write("retry: 2000\n\n");
    let first = latest;
    if (first === null) {
      try {
        const snapshot = options.snapshot();
        first = JSON.stringify(snapshot);
        latest = first;
        lastSent = comparable(snapshot);
        ticksSinceSent = 0;
      } catch {
        // The ticks report a build that keeps failing; this client gets the next snapshot that builds.
      }
    }
    if (first !== null) send(res, UI_EVENTS.snapshot, first);
    clients.add(res);
    res.on("close", () => {
      clients.delete(res);
      if (clients.size === 0) stopTicking();
    });
    timer ??= setInterval(tick, tickMs);
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const host = (req.headers.host ?? "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reply(req, res, 403, TEXT, "forbidden host\n");
    if (req.method !== "GET" && req.method !== "HEAD") {
      return reply(req, res, 405, TEXT, "method not allowed\n", { Allow: "GET, HEAD" });
    }
    const url = req.url ?? "/";
    if (url.length > MAX_URL_LENGTH) return reply(req, res, 414, TEXT, "URL too long\n");
    const origin = req.headers.origin;
    if (req.headers["sec-fetch-site"] === "cross-site" || (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`)) {
      return reply(req, res, 403, TEXT, "forbidden origin\n");
    }

    // Split by hand: new URL() would read `//host/…` as another host.
    const q = url.indexOf("?");
    const path = q === -1 ? url : url.slice(0, q);
    const query = new URLSearchParams(q === -1 ? "" : url.slice(q + 1));
    switch (path) {
      case UI_ROUTES.page:
        return reply(req, res, 200, "text/html; charset=utf-8", options.assets.html);
      case UI_ROUTES.script:
        return reply(req, res, 200, "text/javascript; charset=utf-8", options.assets.js);
      case UI_ROUTES.style:
        return reply(req, res, 200, "text/css; charset=utf-8", options.assets.css);
      case "/favicon.ico":
        res.writeHead(204, SECURITY_HEADERS);
        return void res.end();
      case UI_ROUTES.snapshot:
      case UI_ROUTES.events:
        if (!tokenMatches(query)) return reply(req, res, 401, TEXT, "a valid token is required\n");
        if (path === UI_ROUTES.events) return openEvents(req, res);
        try {
          return reply(req, res, 200, "application/json; charset=utf-8", JSON.stringify(options.snapshot()));
        } catch (err) {
          return reply(req, res, 500, TEXT, `${message(err)}\n`);
        }
      default:
        return reply(req, res, 404, TEXT, "not found\n");
    }
  }

  // A request without Host reaches the Host check (403) instead of the parser's bare 400.
  const server = createServer({ requireHostHeader: false }, (req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      if (!res.headersSent) reply(req, res, 500, TEXT, `${message(err)}\n`);
      else res.destroy();
    }
  });
  // What the parser refuses never reaches `handle`; its answer carries the headers too.
  server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
    if (!socket.writable || err.code === "ECONNRESET") return void socket.destroy();
    const status = err.code === "HPE_HEADER_OVERFLOW" ? "431 Request Header Fields Too Large" : "400 Bad Request";
    const headers = Object.entries(SECURITY_HEADERS).map(([name, value]) => `${name}: ${value}\r\n`);
    socket.end(`HTTP/1.1 ${status}\r\n${headers.join("")}Connection: close\r\nContent-Length: 0\r\n\r\n`);
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      reject(new ArbabError("runtime", `cannot listen on 127.0.0.1:${options.port}: ${err.message}`, { cause: err }));
    });
    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new ArbabError("runtime", "the server has no TCP address"));
        return;
      }
      port = address.port;
      let closing: Promise<void> | null = null;
      resolve({
        url: `http://127.0.0.1:${port}/#${UI_TOKEN_PARAM}=${options.token}`,
        port,
        close: () => {
          closing ??= new Promise<void>((done) => {
            stopTicking();
            for (const res of clients) res.end();
            clients.clear();
            server.close(() => done());
            server.closeAllConnections();
          });
          return closing;
        },
      });
    });
  });
}
