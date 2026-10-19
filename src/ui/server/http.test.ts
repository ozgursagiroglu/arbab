import { request, type IncomingHttpHeaders } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { UI_PROTOCOL, type UiSnapshot } from "../protocol";
import { MAX_URL_LENGTH, SECURITY_HEADERS, startUiServer, type UiServer, type UiServerOptions } from "./http";

const TOKEN = "0123456789abcdef0123456789abcdef";
const ASSETS = { html: "<!doctype html><title>t</title>", css: "body{}", js: "console.log(1)", icon: "<svg/>" };

function snapshot(lanes = 0, now = "2026-10-18T12:00:00.000Z"): UiSnapshot {
  return {
    protocol: UI_PROTOCOL,
    version: "9.9.9",
    project: "demo",
    now,
    lanes: [],
    hiddenLanes: lanes,
    integrations: [],
    quota: {
      status: null,
      fiveHour: null,
      sevenDay: null,
      observedAt: null,
      hold: { hold: false, reason: null, until: null },
      holdAbove: { fiveHour: 0.9, sevenDay: 0.9 },
    },
    maxParallel: 4,
  };
}

/** A snapshot source the test steers: its content, whether it throws, and how often it was called. */
function source() {
  const s = { hidden: 0, tick: 0, fail: null as string | null, calls: 0 };
  const build = (): UiSnapshot => {
    s.calls++;
    s.tick++;
    if (s.fail !== null) throw new Error(s.fail);
    // `now` changes on every build; only `hidden` changes what the page sees.
    return snapshot(s.hidden, new Date(Date.UTC(2026, 9, 18, 12, 0, s.tick)).toISOString());
  };
  return { s, build };
}

let server: UiServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function start(over: Partial<UiServerOptions> = {}): Promise<UiServer> {
  server = await startUiServer({ port: 0, token: TOKEN, assets: ASSETS, snapshot: () => snapshot(), tickMs: 20, ...over });
  return server;
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function get(port: number, path: string, opts: { method?: string; headers?: Record<string, string>; noHost?: boolean } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: opts.method ?? "GET",
        agent: false,
        setHost: opts.noHost !== true,
        headers: { ...(opts.noHost === true ? {} : { host: `127.0.0.1:${port}` }), ...opts.headers },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

interface Sse {
  status: number;
  headers: IncomingHttpHeaders;
  raw: () => string;
  events: Array<{ event: string; data: string }>;
  ended: Promise<void>;
  close(): void;
}

function openSse(port: number, path = `/events?token=${TOKEN}`): Promise<Sse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, agent: false }, (res) => {
      let raw = "";
      let parsed = 0;
      const events: Sse["events"] = [];
      let end = (): void => undefined;
      const ended = new Promise<void>((done) => (end = done));
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        raw += chunk;
        for (let i = raw.indexOf("\n\n", parsed); i !== -1; i = raw.indexOf("\n\n", parsed)) {
          const fields = new Map(
            raw
              .slice(parsed, i)
              .split("\n")
              .map((line) => [line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2)] as const),
          );
          if (fields.has("data")) events.push({ event: fields.get("event") ?? "message", data: fields.get("data") ?? "" });
          parsed = i + 2;
        }
      });
      res.on("end", () => end());
      res.on("close", () => end());
      resolve({ status: res.statusCode ?? 0, headers: res.headers, raw: () => raw, events, ended, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((done) => setTimeout(done, 5));
  }
}
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function expectSecurityHeaders(headers: IncomingHttpHeaders): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers[name.toLowerCase()], name).toBe(value);
  for (const name of Object.keys(headers)) expect(name.startsWith("access-control-"), name).toBe(false);
}

describe("startUiServer: the request checks", () => {
  it("listens on 127.0.0.1 and prints the page URL with the token in the fragment", async () => {
    const s = await start();
    expect(s.port).toBeGreaterThan(0);
    expect(s.url).toBe(`http://127.0.0.1:${s.port}/#token=${TOKEN}`);
  });

  it("copies the DESIGN.md security headers exactly", () => {
    expect(SECURITY_HEADERS).toEqual({
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
  });

  it("accepts Host 127.0.0.1:<port> and localhost:<port> in any case, and refuses every other Host with 403", async () => {
    const { port } = await start();
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `LocalHost:${port}`]) {
      expect((await get(port, "/", { headers: { host } })).status, host).toBe(200);
    }
    for (const host of ["127.0.0.1", "localhost", `127.0.0.1:${port + 1}`, `evil.example:${port}`, `[::1]:${port}`, `0.0.0.0:${port}`]) {
      const r = await get(port, "/", { headers: { host } });
      expect(r.status, host).toBe(403);
      expectSecurityHeaders(r.headers);
    }
    expect((await get(port, "/", { noHost: true })).status).toBe(403);
  });

  it("allows GET and HEAD only: 405 with Allow otherwise", async () => {
    const { port } = await start();
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const r = await get(port, "/", { method });
      expect(r.status, method).toBe(405);
      expect(r.headers["allow"]).toBe("GET, HEAD");
      expectSecurityHeaders(r.headers);
    }
  });

  it("refuses a URL longer than 2,048 characters with 414", async () => {
    const { port } = await start();
    const at = (n: number): string => `/x?${"a".repeat(n - 3)}`;
    expect(at(MAX_URL_LENGTH).length).toBe(2048);
    expect((await get(port, at(MAX_URL_LENGTH))).status).toBe(404);
    const r = await get(port, at(MAX_URL_LENGTH + 1));
    expect(r.status).toBe(414);
    expectSecurityHeaders(r.headers);
  });

  it("refuses Sec-Fetch-Site: cross-site and an Origin that is not the server's own with 403", async () => {
    const { port } = await start();
    for (const site of ["same-origin", "same-site", "none"]) {
      expect((await get(port, "/", { headers: { "sec-fetch-site": site } })).status, site).toBe(200);
    }
    expect((await get(port, "/", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    for (const origin of [`http://127.0.0.1:${port}`, `http://localhost:${port}`]) {
      expect((await get(port, "/", { headers: { origin } })).status, origin).toBe(200);
    }
    for (const origin of ["null", "http://evil.example", `https://127.0.0.1:${port}`, `http://127.0.0.1:${port + 1}`, `http://localhost`]) {
      const r = await get(port, `/snapshot.json?token=${TOKEN}`, { headers: { origin } });
      expect(r.status, origin).toBe(403);
      expectSecurityHeaders(r.headers);
    }
  });

  it("answers a request the HTTP parser refuses with 400 and the headers", async () => {
    const { port } = await start();
    const raw = await new Promise<string>((resolve, reject) => {
      let text = "";
      const socket = connect(port, "127.0.0.1", () => socket.write("NOT HTTP AT ALL\r\n\r\n"));
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => (text += chunk));
      socket.on("close", () => resolve(text));
      socket.on("error", reject);
    });
    expect(raw.startsWith("HTTP/1.1 400 Bad Request\r\n")).toBe(true);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(raw).toContain(`${name}: ${value}\r\n`);
  });

  it("checks Host, then the method, then the URL length, then Sec-Fetch-Site and Origin", async () => {
    const { port } = await start();
    const long = `/${"a".repeat(MAX_URL_LENGTH)}`;
    expect((await get(port, long, { method: "POST", headers: { host: "evil.example" } })).status).toBe(403);
    expect((await get(port, long, { method: "POST", headers: { origin: "http://evil.example" } })).status).toBe(405);
    expect((await get(port, long, { headers: { origin: "http://evil.example" } })).status).toBe(414);
    expect((await get(port, "/nope", { headers: { origin: "http://evil.example" } })).status).toBe(403);
  });
});

describe("startUiServer: the routes", () => {
  it("serves the page, the script and the stylesheet from memory with their types", async () => {
    const { port } = await start();
    const page = await get(port, "/");
    expect(page).toMatchObject({ status: 200, body: ASSETS.html });
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expectSecurityHeaders(page.headers);
    expect(await get(port, "/app.js")).toMatchObject({ status: 200, body: ASSETS.js, headers: { "content-type": "text/javascript; charset=utf-8" } });
    expect(await get(port, "/app.css")).toMatchObject({ status: 200, body: ASSETS.css, headers: { "content-type": "text/css; charset=utf-8" } });
    // The query does not change the route; the public routes need no token.
    expect((await get(port, "/?x=1")).body).toBe(ASSETS.html);
  });

  it("serves the icon as SVG with the headers and no token", async () => {
    const { port } = await start();
    const icon = await get(port, "/icon.svg");
    expect(icon).toMatchObject({ status: 200, body: ASSETS.icon });
    expect(icon.headers["content-type"]).toBe("image/svg+xml; charset=utf-8");
    expectSecurityHeaders(icon.headers);
    expect((await get(port, "/icon.svg?x=1")).status).toBe(200);
    expect((await get(port, "/icon.svg", { method: "HEAD" })).body).toBe("");
  });

  it("answers /favicon.ico with 204 and anything else with 404, both with the headers", async () => {
    const { port } = await start();
    const icon = await get(port, "/favicon.ico");
    expect(icon).toMatchObject({ status: 204, body: "" });
    expectSecurityHeaders(icon.headers);
    for (const path of ["/index.html", "/app.js/", "/APP.JS", "/../app.js", "//127.0.0.1/snapshot.json", "/events/x"]) {
      const r = await get(port, path);
      expect(r.status, path).toBe(404);
      expectSecurityHeaders(r.headers);
      expect(r.body).not.toContain(TOKEN);
    }
  });

  it("needs the token on the data routes: missing, wrong and wrong-length tokens get 401", async () => {
    const { s, build } = source();
    const { port } = await start({ snapshot: build });
    const wrong = TOKEN.slice(0, -1) + (TOKEN.endsWith("f") ? "e" : "f");
    for (const route of ["/snapshot.json", "/events"]) {
      for (const query of ["", "?", "?token=", `?token=${wrong}`, `?token=${TOKEN.slice(1)}`, `?token=${TOKEN}0`, `?Token=${TOKEN}`, `?token=${encodeURIComponent("é".repeat(16))}`]) {
        const r = await get(port, `${route}${query}`);
        expect(r.status, `${route}${query}`).toBe(401);
        expectSecurityHeaders(r.headers);
        expect(r.body).not.toContain(TOKEN);
      }
    }
    expect(s.calls).toBe(0);
  });

  it("builds a snapshot now for /snapshot.json, and answers 500 with the message when the build throws", async () => {
    const { s, build } = source();
    const { port } = await start({ snapshot: build });
    const r = await get(port, `/snapshot.json?token=${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("application/json; charset=utf-8");
    expectSecurityHeaders(r.headers);
    expect((JSON.parse(r.body) as UiSnapshot).project).toBe("demo");
    expect(s.calls).toBe(1);
    s.fail = "the registry is gone";
    const failed = await get(port, `/snapshot.json?token=${TOKEN}`);
    expect(failed.status).toBe(500);
    expect(failed.body).toContain("the registry is gone");
    expectSecurityHeaders(failed.headers);
  });

  it("answers HEAD with the headers and no body", async () => {
    const { port } = await start();
    for (const path of ["/", "/app.js", `/snapshot.json?token=${TOKEN}`, "/nope", "/snapshot.json"]) {
      const get_ = await get(port, path);
      const head = await get(port, path, { method: "HEAD" });
      expect(head.status, path).toBe(get_.status);
      expect(head.body, path).toBe("");
      expect(head.headers["content-type"], path).toBe(get_.headers["content-type"]);
      expect(head.headers["content-length"], path).toBe(String(Buffer.byteLength(get_.body)));
      expectSecurityHeaders(head.headers);
    }
    const events = await get(port, `/events?token=${TOKEN}`, { method: "HEAD" });
    expect(events).toMatchObject({ status: 200, body: "", headers: { "content-type": "text/event-stream; charset=utf-8" } });
  });
});

describe("startUiServer: the event stream", () => {
  it("sends retry: 2000, then the current snapshot as one line of JSON, with the stream headers", async () => {
    const { build } = source();
    const { port } = await start({ snapshot: build, tickMs: 10_000 });
    const sse = await openSse(port);
    expect(sse.status).toBe(200);
    expect(sse.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(sse.headers["connection"]).toBe("keep-alive");
    expectSecurityHeaders(sse.headers);
    await until(() => sse.events.length === 1);
    expect(sse.raw().startsWith("retry: 2000\n\nevent: snapshot\ndata: {")).toBe(true);
    expect(sse.events[0]?.event).toBe("snapshot");
    expect((JSON.parse(sse.events[0]?.data ?? "") as UiSnapshot).protocol).toBe(UI_PROTOCOL);
    sse.close();
  });

  it("sends a snapshot when a tick finds it changed, and none when only `now` changed", async () => {
    const { s, build } = source();
    const { port } = await start({ snapshot: build, heartbeatMs: 60_000 });
    const sse = await openSse(port);
    await until(() => sse.events.length === 1);
    const before = s.calls;
    await until(() => s.calls >= before + 5);
    expect(sse.events).toHaveLength(1);
    s.hidden = 7;
    await until(() => sse.events.length === 2);
    expect((JSON.parse(sse.events[1]?.data ?? "") as UiSnapshot).hiddenLanes).toBe(7);
    const after = s.calls;
    await until(() => s.calls >= after + 5);
    expect(sse.events).toHaveLength(2);
    sse.close();
  });

  it("sends the snapshot at least every heartbeatMs, changed or not", async () => {
    const { s, build } = source();
    const { port } = await start({ snapshot: build, tickMs: 20, heartbeatMs: 60 });
    const sse = await openSse(port);
    await until(() => sse.events.length >= 3);
    // A heartbeat every third tick: never more often than that.
    expect(s.calls).toBeGreaterThanOrEqual(1 + 3 * (sse.events.length - 1));
    const nows = sse.events.map((e) => (JSON.parse(e.data) as UiSnapshot).now);
    expect(new Set(nows).size).toBe(nows.length);
    sse.close();
  });

  it("builds once per tick for every client, and gives a new client the newest snapshot at once", async () => {
    const { s, build } = source();
    const { port } = await start({ snapshot: build, tickMs: 40 });
    const a = await openSse(port);
    const b = await openSse(port);
    await until(() => a.events.length === 1 && b.events.length === 1);
    s.hidden = 1;
    await until(() => a.events.length === 2 && b.events.length === 2);
    expect(a.events[1]).toEqual(b.events[1]);
    const calls = s.calls;
    await pause(200);
    // About five ticks; two clients would make it about ten if each built its own.
    expect(s.calls - calls).toBeLessThanOrEqual(7);
    a.close();
    b.close();
  });

  it("skips a tick whose build throws and sends one problem after three in a row, until a build succeeds", async () => {
    const { s, build } = source();
    const { port } = await start({ snapshot: build, heartbeatMs: 60_000 });
    const sse = await openSse(port);
    await until(() => sse.events.length === 1);
    s.fail = "x".repeat(300);
    const failingFrom = s.calls;
    await until(() => sse.events.length === 2);
    // Three failed ticks, give or take the one that ran while this test polled.
    expect(s.calls - failingFrom).toBeGreaterThanOrEqual(3);
    expect(s.calls - failingFrom).toBeLessThanOrEqual(4);
    expect(sse.events[1]?.event).toBe("problem");
    expect(JSON.parse(sse.events[1]?.data ?? "")).toEqual({ message: "x".repeat(200) });
    const more = s.calls;
    await until(() => s.calls >= more + 5);
    expect(sse.events).toHaveLength(2);
    // Recovery: the first build after the problem goes out.
    s.fail = null;
    s.hidden = 3;
    await until(() => sse.events.length === 3);
    expect(sse.events[2]?.event).toBe("snapshot");
    s.fail = "again";
    await until(() => sse.events.length === 4);
    expect(sse.events[3]).toEqual({ event: "problem", data: JSON.stringify({ message: "again" }) });
    sse.close();
  });

  it("sends the first build after a problem to every client at once, though it did not change", async () => {
    const { s, build } = source();
    const { port } = await start({ snapshot: build, heartbeatMs: 60_000 });
    const a = await openSse(port);
    const b = await openSse(port);
    await until(() => a.events.length === 1 && b.events.length === 1);
    s.fail = "down";
    await until(() => a.events.length === 2 && b.events.length === 2);
    expect(a.events[1]?.event).toBe("problem");
    expect(b.events[1]?.event).toBe("problem");
    s.fail = null;
    await until(() => a.events.length === 3 && b.events.length === 3);
    for (const sse of [a, b]) {
      expect(sse.events[2]?.event).toBe("snapshot");
      expect((JSON.parse(sse.events[2]?.data ?? "") as UiSnapshot).hiddenLanes).toBe(0);
    }
    expect(a.events[2]).toEqual(b.events[2]);
    // Back to normal: unchanged snapshots are not sent again.
    const after = s.calls;
    await until(() => s.calls >= after + 5);
    expect(a.events).toHaveLength(3);
    a.close();
    b.close();
  });

  it("gives a client that connects while a problem stands the latest snapshot, then the problem", async () => {
    const { s, build } = source();
    const { port } = await start({ snapshot: build, heartbeatMs: 60_000 });
    const a = await openSse(port);
    await until(() => a.events.length === 1);
    s.fail = "registry unreadable";
    await until(() => a.events.length === 2);
    const b = await openSse(port);
    await until(() => b.events.length === 2);
    const problem = { event: "problem", data: JSON.stringify({ message: "registry unreadable" }) };
    expect(b.raw().startsWith(`retry: 2000\n\nevent: snapshot\ndata: ${a.events[0]?.data}\n\nevent: problem\n`)).toBe(true);
    expect(b.events).toEqual([a.events[0], problem]);
    // Only once: the ticks that keep failing send nothing more.
    const more = s.calls;
    await until(() => s.calls >= more + 4);
    expect(b.events).toHaveLength(2);
    expect(a.events).toHaveLength(2);
    a.close();
    b.close();
  });

  it("gives a client that connects while a problem stands and nothing ever built the problem right after retry", async () => {
    const { s, build } = source();
    s.fail = "broken";
    const { port } = await start({ snapshot: build });
    const a = await openSse(port);
    await until(() => a.events.length === 1);
    const b = await openSse(port);
    await until(() => b.events.length === 1);
    expect(b.raw().startsWith("retry: 2000\n\nevent: problem\n")).toBe(true);
    expect(b.events).toEqual([{ event: "problem", data: JSON.stringify({ message: "broken" }) }]);
    // The build recovers, by a tick or by the next client's connect: everyone gets the snapshot, no one the problem.
    s.fail = null;
    const c = await openSse(port);
    await until(() => a.events.length === 2 && b.events.length === 2 && c.events.length === 1);
    for (const sse of [a, b, c]) expect(sse.events.at(-1)?.event).toBe("snapshot");
    a.close();
    b.close();
    c.close();
  });

  it("answers 503 to one client more than maxClients, and takes a new one after a client leaves", async () => {
    const { port } = await start({ maxClients: 2 });
    const a = await openSse(port);
    const b = await openSse(port);
    const third = await get(port, `/events?token=${TOKEN}`);
    expect(third.status).toBe(503);
    expectSecurityHeaders(third.headers);
    a.close();
    await a.ended;
    // HEAD passes the same client check without joining the stream.
    let status = 0;
    for (let i = 0; i < 100 && status !== 200; i++) {
      status = (await get(port, `/events?token=${TOKEN}`, { method: "HEAD" })).status;
      if (status !== 200) await pause(10);
    }
    expect(status).toBe(200);
    const c = await openSse(port);
    expect(c.status).toBe(200);
    c.close();
    b.close();
  });

  it("builds nothing while no client listens, and stops with the last client", async () => {
    const { s, build } = source();
    const { port } = await start({ snapshot: build });
    await get(port, "/");
    await pause(100);
    expect(s.calls).toBe(0);
    const sse = await openSse(port);
    await until(() => s.calls >= 3);
    sse.close();
    await sse.ended;
    await pause(40);
    const stopped = s.calls;
    await pause(120);
    expect(s.calls).toBe(stopped);
  });

  it("does not build on connect when the build throws; the ticks report it", async () => {
    const { s, build } = source();
    s.fail = "broken";
    const { port } = await start({ snapshot: build });
    const sse = await openSse(port);
    await until(() => sse.events.length === 1);
    expect(sse.events[0]?.event).toBe("problem");
    s.fail = null;
    await until(() => sse.events.length === 2);
    expect(sse.events[1]?.event).toBe("snapshot");
    sse.close();
  });

  it("close() ends every event stream, closes the connections and stops listening", async () => {
    const s = await start();
    const sse = await openSse(s.port);
    await until(() => sse.events.length === 1);
    await s.close();
    await sse.ended;
    await expect(get(s.port, "/")).rejects.toThrow();
    // A second close is the same promise, not an error.
    await s.close();
    server = null;
  });
});
