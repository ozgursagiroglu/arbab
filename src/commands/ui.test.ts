import type { spawn } from "node:child_process";
import { get } from "node:http";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { UiSnapshot } from "../ui/protocol";
import { makeOpenUrl } from "./context";
import { dispatch } from "./index";
import { makeProject, NOW_MS, writeLaneRun, type TestProject } from "./testkit";
import { runUi } from "./ui";

let p: TestProject;
afterEach(() => p?.dispose());

interface Running {
  url: string;
  port: number;
  token: string;
  stop(): void;
  done: Promise<number>;
  untrapped: () => boolean;
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((done) => setTimeout(done, 5));
  }
}

/** Starts runUi with a trapSignals that hands the test the handler, and waits for the printed URL. */
async function startUi(argv: string[]): Promise<Running> {
  let handler: (() => void) | null = null;
  let untrapped = false;
  p.ctx.trapSignals = (h) => {
    handler = h;
    return () => {
      untrapped = true;
    };
  };
  const done = runUi(argv, p.ctx);
  let failed: unknown = null;
  done.catch((err: unknown) => (failed = err));
  await until(() => failed !== null || /http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]+/.test(p.stdout()));
  if (failed !== null) throw failed;
  const match = /http:\/\/127\.0\.0\.1:(\d+)\/#token=([0-9a-f]+)/.exec(p.stdout());
  return {
    url: match?.[0] ?? "",
    port: Number(match?.[1]),
    token: match?.[2] ?? "",
    stop: () => (handler as (() => void) | null)?.(),
    done,
    untrapped: () => untrapped,
  };
}

function fetchText(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    get({ host: "127.0.0.1", port, path, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe("runUi", () => {
  it("prints the project and the URL, opens it, serves the page and the snapshot, and stops on the signal", async () => {
    p = makeProject();
    const ui = await startUi([]);
    expect(ui.token).toMatch(/^[0-9a-f]{32}$/);
    expect(p.stdout()).toBe(`arbab ui: repo at ${ui.url}\nread-only; Ctrl-C stops it\n`);
    expect(p.opened).toEqual([ui.url]);
    expect(p.stderr()).toBe("");
    expect((await fetchText(ui.port, "/")).status).toBe(200);
    const snap = await fetchText(ui.port, `/snapshot.json?token=${ui.token}`);
    expect(snap.status).toBe(200);
    expect(JSON.parse(snap.body) as UiSnapshot).toMatchObject({ project: "repo", version: "9.9.9", now: new Date(NOW_MS).toISOString() });
    expect((await fetchText(ui.port, "/snapshot.json")).status).toBe(401);
    ui.stop();
    expect(await ui.done).toBe(0);
    expect(ui.untrapped()).toBe(true);
    await expect(fetchText(ui.port, "/")).rejects.toThrow();
  });

  it("prints {url, port} with --json and does not open the browser with --no-open", async () => {
    p = makeProject();
    const ui = await startUi(["--json", "--no-open"]);
    expect(JSON.parse(p.stdout())).toEqual({ url: ui.url, port: ui.port });
    expect(p.opened).toEqual([]);
    ui.stop();
    expect(await ui.done).toBe(0);
  });

  it("asks for the URL to be opened by hand when there is no opener", async () => {
    p = makeProject();
    p.ctx.openUrl = () => false;
    const ui = await startUi([]);
    expect(p.stderr()).toBe(`open ${ui.url} in a browser\n`);
    ui.stop();
    expect(await ui.done).toBe(0);
  });

  it("listens on the --port it is given", async () => {
    p = makeProject();
    const port = await freePort();
    const ui = await startUi(["--port", String(port), "--no-open"]);
    expect(ui.port).toBe(port);
    ui.stop();
    expect(await ui.done).toBe(0);
  });

  it("uses --hours as the window", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "old", { state: "finished", endState: "success", since: new Date(NOW_MS - 30 * 3_600_000).toISOString() });
    for (const [argv, lanes] of [
      [[], []],
      [["--hours", "48"], ["old"]],
    ] as const) {
      p.out.length = 0;
      const ui = await startUi(["--no-open", ...argv]);
      const snap = JSON.parse((await fetchText(ui.port, `/snapshot.json?token=${ui.token}`)).body) as UiSnapshot;
      expect(snap.lanes.map((l) => l.name)).toEqual(lanes);
      ui.stop();
      expect(await ui.done).toBe(0);
    }
  });

  it("refuses ports, hours and flags it does not know with exit 1", async () => {
    p = makeProject();
    for (const argv of [
      ["--port", "-1"],
      ["--port", "65536"],
      ["--port", "http"],
      ["--port", "1.5"],
      ["--port", ""],
      ["--port", "0x10"],
      ["--hours", "0"],
      ["--hours", "721"],
      ["--hours", "2.5"],
      ["--hours", "1e2"],
      ["--open"],
      ["--no-open=yes"],
      ["extra"],
    ]) {
      p.err.length = 0;
      expect(await dispatch(["ui", ...argv], p.ctx), argv.join(" ")).toBe(1);
      expect(p.stderr()).toMatch(/^arbab ui: /);
    }
    expect(p.opened).toEqual([]);
  });

  it("refuses a port that is taken with exit 2", async () => {
    p = makeProject();
    const blocker = createServer();
    await new Promise<void>((done) => blocker.listen(0, "127.0.0.1", done));
    const address = blocker.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      expect(await dispatch(["ui", "--port", String(port), "--no-open"], p.ctx)).toBe(2);
      expect(p.stderr()).toContain(`cannot listen on 127.0.0.1:${port}`);
    } finally {
      await new Promise((done) => blocker.close(done));
    }
  });
});

describe("makeOpenUrl", () => {
  function fakeSpawn() {
    const calls: Array<{ command: string; args: readonly string[]; options: unknown }> = [];
    const events: string[] = [];
    const fn = ((command: string, args: readonly string[], options: unknown) => {
      calls.push({ command, args, options });
      return {
        on: (event: string) => events.push(`on:${event}`),
        unref: () => events.push("unref"),
      };
    }) as unknown as typeof spawn;
    return { fn, calls, events };
  }

  it("runs open on macOS and xdg-open on Linux, detached and ignored, and returns true", () => {
    for (const [platform, command] of [
      ["darwin", "open"],
      ["linux", "xdg-open"],
    ] as const) {
      const fake = fakeSpawn();
      expect(makeOpenUrl(platform, fake.fn)("http://127.0.0.1:1/#token=ab")).toBe(true);
      expect(fake.calls).toEqual([{ command, args: ["http://127.0.0.1:1/#token=ab"], options: { detached: true, stdio: "ignore" } }]);
      expect(fake.events).toEqual(["on:error", "unref"]);
    }
  });

  it("returns false and starts nothing on any other platform", () => {
    for (const platform of ["win32", "freebsd", "aix"] as const) {
      const fake = fakeSpawn();
      expect(makeOpenUrl(platform, fake.fn)("http://127.0.0.1:1/")).toBe(false);
      expect(fake.calls).toEqual([]);
    }
  });
});
