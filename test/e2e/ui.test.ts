// `arbab ui` end to end: the real bundle serves a temporary project on 127.0.0.1 until SIGTERM.
import { spawn } from "node:child_process";
import { get } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildBundle, makeE2eProject, type E2eProject } from "./harness";

let bundle: { bundle: string; dispose(): void };
let p: E2eProject | undefined;

beforeAll(async () => {
  bundle = await buildBundle();
}, 60_000);
afterAll(() => bundle?.dispose());
afterEach(() => {
  p?.dispose();
  p = undefined;
});

function fetchText(port: number, path: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    get({ host: "127.0.0.1", port, path, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), body }));
    }).on("error", reject);
  });
}

describe("arbab ui", () => {
  it("prints the URL as JSON, serves the page and the snapshot, and exits 0 on SIGTERM", async () => {
    p = makeE2eProject(bundle.bundle);
    const child = spawn(process.execPath, [bundle.bundle, "ui", "--no-open", "--json"], { cwd: p.root, env: p.env, stdio: ["ignore", "pipe", "pipe"] });
    const exited = new Promise<{ code: number | null; signal: string | null }>((done) => child.on("exit", (code, signal) => done({ code, signal })));
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    try {
      // printJson writes the object over several lines: read until it is whole.
      const printed = await new Promise<{ url: string; port: number }>((resolve, reject) => {
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          if (!stdout.includes("\n}\n")) return;
          try {
            resolve(JSON.parse(stdout) as { url: string; port: number });
          } catch (err) {
            reject(err);
          }
        });
        void exited.then(() => reject(new Error(`arbab ui exited early: ${stderr}`)));
      });
      expect(printed.url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${printed.port}/#token=[0-9a-f]{32}$`));
      const token = printed.url.slice(printed.url.indexOf("#token=") + "#token=".length);

      const page = await fetchText(printed.port, "/");
      expect(page.status).toBe(200);
      expect(page.type).toBe("text/html; charset=utf-8");

      // The bundle carries main.ts built for the browser, not the placeholder served from source.
      const script = await fetchText(printed.port, "/app.js");
      expect(script.status).toBe(200);
      expect(script.body).toContain("This browser cannot draw the scene");
      expect(script.body).not.toContain("The page script is built by pnpm build.");

      // The page icon: the pixel pyramid, as SVG.
      const icon = await fetchText(printed.port, "/icon.svg");
      expect(icon.status).toBe(200);
      expect(icon.type).toMatch(/^image\/svg\+xml\b/);
      expect(icon.body).toMatch(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);

      const snapshot = await fetchText(printed.port, `/snapshot.json?token=${token}`);
      expect(snapshot.status).toBe(200);
      const body = JSON.parse(snapshot.body) as { protocol: number; project: string; lanes: unknown[] };
      expect(body).toMatchObject({ protocol: 1, project: "repo", lanes: [] });
      expect(snapshot.body).not.toContain(p.dir);

      expect((await fetchText(printed.port, "/snapshot.json")).status).toBe(401);

      child.kill("SIGTERM");
      expect(await exited).toEqual({ code: 0, signal: null });
      expect(stderr).toBe("");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });
});
