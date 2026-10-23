import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = path.join(root, "site");
const base = "https://ozgursagiroglu.github.io/arbab/";
const basePath = "/arbab/";

const htmlFiles = fs
  .readdirSync(siteDir)
  .filter((name) => name.endsWith(".html"))
  .sort();
const read = (name: string): string => fs.readFileSync(path.join(siteDir, name), "utf8");

interface Attr {
  tag: string;
  name: string;
  value: string;
}

/** Every tag's attributes, from the opening tags of the document. */
function attributes(html: string): Attr[] {
  const out: Attr[] = [];
  for (const tag of html.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
    const tagName = (tag[1] ?? "").toLowerCase();
    for (const attr of (tag[2] ?? "").matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
      out.push({ tag: tagName, name: (attr[1] ?? "").toLowerCase(), value: attr[2] ?? "" });
    }
  }
  return out;
}

/** Opening tags of one element, each as a map of its attributes. */
function elements(html: string, name: string): Map<string, string>[] {
  const out: Map<string, string>[] = [];
  for (const tag of html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))) {
    const attrs = new Map<string, string>();
    for (const attr of (tag[1] ?? "").matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
      attrs.set((attr[1] ?? "").toLowerCase(), attr[2] ?? "");
    }
    out.push(attrs);
  }
  return out;
}

/**
 * The file under site/ a link names, or null when it points off the site. Relative links resolve from site/;
 * root-relative ones and absolute ones under the canonical URL are the site's own (404.html uses them).
 */
function siteTarget(ref: string): string | null {
  const clean = ref.split("#")[0]?.split("?")[0] ?? "";
  if (ref.startsWith("#") || clean === "") return null;
  let rel: string;
  if (clean.startsWith(base)) rel = clean.slice(base.length);
  else if (clean.startsWith(basePath)) rel = clean.slice(basePath.length);
  else if (/^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith("//") || clean.startsWith("/")) return null;
  else rel = clean;
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  return path.resolve(siteDir, decodeURIComponent(rel));
}

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
const plain = (html: string): string => decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

function jsonLd(html: string): unknown[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (block) => JSON.parse(block[1] ?? "") as unknown,
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const head = fs.readFileSync(file).subarray(0, 24);
  expect(head.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

describe("site", () => {
  it("has the pages it publishes", () => {
    expect(htmlFiles).toEqual(["404.html", "index.html"]);
    for (const name of ["styles.css", "sitemap.xml"]) {
      expect(fs.existsSync(path.join(siteDir, name)), name).toBe(true);
    }
  });

  it.each(htmlFiles)("%s: every local href, src and poster names a file under site/", (name) => {
    const html = read(name);
    const refs = attributes(html).filter((a) => ["href", "src", "poster"].includes(a.name));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const target = siteTarget(ref.value);
      if (target === null) continue;
      expect(target.startsWith(siteDir + path.sep), `${ref.value} stays in site/`).toBe(true);
      expect(fs.statSync(target, { throwIfNoEntry: false })?.isFile(), `${ref.value} exists`).toBe(true);
    }
  });

  it.each(htmlFiles)("%s: makes no external requests and runs no JavaScript", (name) => {
    const html = read(name);
    expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=/i);
    for (const script of html.matchAll(/<script\b([^>]*)>/gi)) {
      expect(script[1]).toMatch(/type="application\/ld\+json"/);
    }
    // Media and stylesheets load from the site itself; plain links may point anywhere.
    for (const attr of attributes(html)) {
      if (attr.name === "src" || attr.name === "poster") {
        expect(siteTarget(attr.value), attr.value).not.toBeNull();
      }
    }
    for (const link of elements(html, "link")) {
      const rel = link.get("rel") ?? "";
      if (/stylesheet|icon|preload|prefetch|modulepreload/.test(rel)) {
        expect(siteTarget(link.get("href") ?? ""), rel).not.toBeNull();
      }
    }
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("styles.css loads nothing from elsewhere", () => {
    const css = read("styles.css");
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
    expect(css).not.toMatch(/@font-face/);
  });

  it.each(htmlFiles)("%s: has exactly one h1 and lang en", (name) => {
    const html = read(name);
    expect(html.match(/<h1\b/g)?.length).toBe(1);
    expect(html).toMatch(/<html lang="en">/);
  });

  it.each(htmlFiles)("%s: every JSON-LD block parses", (name) => {
    const html = read(name);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    for (const block of blocks) expect(() => JSON.parse(block[1] ?? "")).not.toThrow();
  });

  it.each(htmlFiles)("%s: every img has alt text and its size; PNG sizes match the file", (name) => {
    for (const img of elements(read(name), "img")) {
      const src = img.get("src") ?? "";
      expect(img.has("alt"), src).toBe(true);
      expect(Number(img.get("width")), src).toBeGreaterThan(0);
      expect(Number(img.get("height")), src).toBeGreaterThan(0);
      const target = siteTarget(src);
      if (target?.endsWith(".png")) {
        expect(pngSize(target), src).toEqual({ width: Number(img.get("width")), height: Number(img.get("height")) });
      }
    }
  });

  describe("index.html", () => {
    const html = read("index.html");
    const meta = (key: string): string | undefined =>
      elements(html, "meta").find((m) => m.get("property") === key || m.get("name") === key)?.get("content");

    it("has a canonical URL and absolute Open Graph URLs under the site", () => {
      const canonical = elements(html, "link").find((l) => l.get("rel") === "canonical")?.get("href");
      expect(canonical).toBe(base);
      expect(meta("og:url")).toBe(base);
      expect(meta("og:type")).toBe("website");
      const image = meta("og:image") ?? "";
      expect(image).toBe(`${base}assets/og.jpg`);
      expect(fs.existsSync(siteTarget(image) ?? "")).toBe(true);
      expect(meta("og:image:width")).toBe("1280");
      expect(meta("og:image:height")).toBe("640");
      expect(meta("og:image:alt")).toBeTruthy();
      expect(meta("twitter:card")).toBe("summary_large_image");
      expect(meta("description")).toBeTruthy();
    });

    it("describes the software and its FAQ in JSON-LD", () => {
      const blocks = jsonLd(html).filter(isRecord);
      const app = blocks.find((b) => b["@type"] === "SoftwareApplication");
      expect(app).toMatchObject({
        name: "arbab",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "macOS",
        url: base,
        author: { "@type": "Person", name: "Özgür Sağıroğlu", url: "https://github.com/ozgursagiroglu" },
        offers: { "@type": "Offer", price: "0" },
      });
      expect(blocks.some((b) => b["@type"] === "FAQPage")).toBe(true);
    });

    it("has the same questions and answers in the FAQ and its JSON-LD", () => {
      const faq = jsonLd(html).filter(isRecord).find((b) => b["@type"] === "FAQPage");
      const entities = Array.isArray(faq?.["mainEntity"]) ? (faq["mainEntity"] as unknown[]) : [];
      const fromLd = entities.filter(isRecord).map((q) => {
        const answer = q["acceptedAnswer"];
        return { q: String(q["name"]), a: isRecord(answer) ? String(answer["text"]) : "" };
      });
      const shown = [...html.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)].map(
        (d) => ({ q: plain(d[1] ?? ""), a: plain(d[2] ?? "") }),
      );
      expect(shown.length).toBeGreaterThanOrEqual(6);
      expect(shown.length).toBeLessThanOrEqual(7);
      expect(fromLd).toEqual(shown);
    });

    it("has the sections in order, each linked from the header nav", () => {
      const ids = ["hero", "why", "how", "fence", "lanes", "sessions", "examples", "install", "faq"];
      const positions = ids.map((id) => html.indexOf(`<section id="${id}"`));
      expect(positions.every((p) => p >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      const nav = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
      for (const id of ids) expect(nav, id).toContain(`href="#${id}"`);
    });
  });

  it("links the sitemap from the head, and the sitemap lists the canonical URL", () => {
    // Crawlers never read robots.txt under /arbab/, so the page itself points to the sitemap.
    const link = elements(read("index.html"), "link").find((l) => l.get("rel") === "sitemap");
    expect(link?.get("type")).toBe("application/xml");
    expect(link?.get("href")).toBe("sitemap.xml");
    expect(read("sitemap.xml")).toContain(`<loc>${base}</loc>`);
  });

  it("gives every video poster the video's declared size", () => {
    const videos = elements(read("index.html"), "video");
    expect(videos.length).toBeGreaterThan(0);
    for (const video of videos) {
      const poster = video.get("poster") ?? "";
      const target = siteTarget(poster);
      if (target === null) throw new Error(`poster ${poster} is not under site/`);
      expect(pngSize(target), poster).toEqual({
        width: Number(video.get("width")),
        height: Number(video.get("height")),
      });
    }
  });

  it("pins every action in the Pages workflow to a full commit SHA", () => {
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/pages.yml"), "utf8");
    const uses = [...workflow.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1] ?? "");
    expect(uses.length).toBe(6);
    for (const ref of uses) expect(ref, ref).toMatch(/^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/);
  });
});
