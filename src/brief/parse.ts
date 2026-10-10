import type { BriefSectionName, BriefSource } from "../types";
import { scanLines } from "./markdown";

export const SECTION_NAMES: readonly BriefSectionName[] = ["Task", "Scope", "Acceptance", "Facts", "Unverified", "Notes"];

const TITLE = /^# +(.*?)(?:\s+#+)?\s*$/;
const SECTION = /^## +(.*?)(?:\s+#+)?\s*$/;

interface Block {
  name: string;
  text: string;
}

function isSectionName(name: string): name is BriefSectionName {
  return (SECTION_NAMES as readonly string[]).includes(name);
}

/** The title and the `##` blocks in document order; text before the first `##` (other than the title) is dropped. */
function splitBlocks(markdown: string): { title: string; blocks: Block[] } {
  let title: string | null = null;
  const blocks: Array<{ name: string; lines: string[] }> = [];
  for (const line of scanLines(markdown)) {
    if (!line.inFence) {
      const section = SECTION.exec(line.text)?.[1];
      if (section !== undefined && section !== "") {
        blocks.push({ name: section, lines: [] });
        continue;
      }
      const heading: string | undefined = title === null ? TITLE.exec(line.text)?.[1] : undefined;
      if (heading !== undefined) {
        title = heading;
        continue;
      }
    }
    blocks.at(-1)?.lines.push(line.text);
  }
  return { title: title ?? "", blocks: blocks.map((b) => ({ name: b.name, text: b.lines.join("\n").trim() })) };
}

export function parseBriefSource(markdown: string): BriefSource {
  const { title, blocks } = splitBlocks(markdown);
  const parts: Partial<Record<BriefSectionName, string[]>> = {};
  for (const { name, text } of blocks) {
    // Unknown sections are kept, under Notes, so nothing the orchestrator wrote is lost.
    const key: BriefSectionName = isSectionName(name) ? name : "Notes";
    const value = isSectionName(name) ? text : text === "" ? `### ${name}` : `### ${name}\n\n${text}`;
    (parts[key] ??= []).push(value);
  }
  const sections: BriefSource["sections"] = {};
  for (const name of SECTION_NAMES) {
    const list = parts[name];
    if (list !== undefined) sections[name] = list.filter((p) => p !== "").join("\n\n");
  }
  return { title, sections };
}

export function unknownSections(markdown: string): string[] {
  return splitBlocks(markdown)
    .blocks.map((b) => b.name)
    .filter((name) => !isSectionName(name));
}
