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

const URL_WITH_TOKEN = /http:\/\/127\.0\.0\.1:(\d+)\/#token=([0-9a-f]+)/;

/**
 * Starts runUi with a trapSignals that hands the test the handler, and waits for the printed lines. The URL with its
 * token comes from stdout, or from the opener when the browser opened (stdout then has none).
 */
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
  await until(() => failed !== null || /Ctrl-C stops it\n|"port"/.test(p.stdout()));
  if (failed !== null) throw failed;
  const match = URL_WITH_TOKEN.exec(p.stdout()) ?? URL_WITH_TOKEN.exec(p.opened.at(-1) ?? "");
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
  it("opens the URL, prints the project and the URL without the token, serves the page and the snapshot, and stops on the signal", async () => {
    p = makeProject();
    const ui = await startUi([]);
    expect(ui.token).toMatch(/^[0-9a-f]{32}$/);
    expect(p.opened).toEqual([ui.url]);
    expect(p.stdout()).toBe(`arbab ui: repo at http://127.0.0.1:${ui.port}/ (opened in your browser)\nread-only; Ctrl-C stops it\n`);
    expect(p.stdout()).not.toContain(ui.token);
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

  it("prints the URL with the token and opens nothing with --no-open", async () => {
    p = makeProject();
    const ui = await startUi(["--no-open"]);
    expect(p.stdout()).toBe(`arbab ui: repo at ${ui.url}\nread-only; Ctrl-C stops it\n`);
    expect(ui.url).toContain(`#token=${ui.token}`);
    expect(p.opened).toEqual([]);
    expect(p.stderr()).toBe("");
    ui.stop();
    expect(await ui.done).toBe(0);
  });

  it("prints {url, port} with the token under --json, whether it opened the browser or not", async () => {
    p = makeProject();
    const quiet = await startUi(["--json", "--no-open"]);
    expect(JSON.parse(p.stdout())).toEqual({ url: quiet.url, port: quiet.port });
    expect(quiet.url).toContain(`#token=${quiet.token}`);
    expect(p.opened).toEqual([]);
    quiet.stop();
    expect(await quiet.done).toBe(0);

    p.out.length = 0;
    const opened = await startUi(["--json"]);
    expect(JSON.parse(p.stdout())).toEqual({ url: opened.url, port: opened.port });
    expect(p.opened).toEqual([opened.url]);
    expect(p.stderr()).toBe("");
    opened.stop();
    expect(await opened.done).toBe(0);
  });

  it("prints the URL with the token and asks for it to be opened by hand when the opener fails", async () => {
    p = makeProject();
    const tried: string[] = [];
    p.ctx.openUrl = (url) => {
      tried.push(url);
      return false;
    };
    const ui = await startUi([]);
    expect(tried).toEqual([ui.url]);
    expect(p.stdout()).toBe(`arbab ui: repo at ${ui.url}\nread-only; Ctrl-C stops it\n`);
    expect(ui.url).toContain(`#token=${ui.token}`);
    expect(p.stderr()).toBe("open the URL above in a browser\n");
    ui.stop();
    expect(await ui.done).toBe(0);

    p.out.length = 0;
    p.err.length = 0;
    const json = await startUi(["--json"]);
    expect(JSON.parse(p.stdout())).toEqual({ url: json.url, port: json.port });
    expect(p.stderr()).toBe("open the URL above in a browser\n");
    json.stop();
    expect(await json.done).toBe(0);
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
