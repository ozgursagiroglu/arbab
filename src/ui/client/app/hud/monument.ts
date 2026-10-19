// The monument panel (DESIGN.md §19): the current integration as a vertical stepper, integrated → verify → review →
// ready → landed.
import type { UiIntegration, UiSnapshot } from "../../../protocol";
import { epochMs, featuredIntegration } from "../../scene/scene";
import type { DocumentLike, ElementLike } from "../browser";
import { formatAgo } from "./chronicle";
import { make } from "./dom";
import type { PixelText } from "./pixel-text";
import { createPixelText } from "./pixel-text";
import { TOKENS } from "./tokens";

export type StepState = "done" | "failed" | "pending";

export interface Step {
  label: string;
  state: StepState;
  /** ✓, ✗ or ·. */
  mark: string;
  detail: string;
}

const MARKS: Readonly<Record<StepState, string>> = { done: "✓", failed: "✗", pending: "·" };

function step(label: string, state: StepState, detail: string): Step {
  return { label, state, mark: MARKS[state], detail };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** `2 lenses · 1 confirmed · 2 unverified` */
export function formatReview(review: NonNullable<UiIntegration["review"]>): string {
  return `${review.lenses} ${review.lenses === 1 ? "lens" : "lenses"} · ${review.confirmed} confirmed · ${review.unverified} unverified`;
}

export function monumentSteps(integration: UiIntegration, nowMs: number): Step[] {
  const verify = integration.verify;
  const ready = integration.ready;
  const landedAt = epochMs(integration.landedAt);
  return [
    step("INTEGRATED", "done", plural(integration.lanes.length, "lane")),
    verify === "passed" ? step("VERIFY", "done", "passed") : verify === "failed" ? step("VERIFY", "failed", "failed") : step("VERIFY", "pending", "not run"),
    integration.review ? step("REVIEW", "done", formatReview(integration.review)) : step("REVIEW", "pending", "not run"),
    ready === true ? step("READY", "done", "ready") : ready === false ? step("READY", "failed", "not ready") : step("READY", "pending", "not checked"),
    integration.landedAt !== null
      ? step("LANDED", "done", Number.isFinite(landedAt) ? formatAgo(nowMs - landedAt) : "landed")
      : step("LANDED", "pending", "not landed"),
  ];
}

export const STEP_COLORS: Readonly<Record<StepState, string>> = {
  done: TOKENS.gold,
  failed: TOKENS["st-failed"],
  pending: TOKENS.faint,
};

interface StepView {
  li: ElementLike;
  mark: PixelText;
  label: PixelText;
  detail: ElementLike;
}

export interface MonumentPanel {
  update(snapshot: UiSnapshot, nowMs: number): void;
}

export function mountMonument(doc: DocumentLike, els: { title: ElementLike; body: ElementLike }, dpr: number): MonumentPanel {
  const title = createPixelText(doc, { scale: 2, color: TOKENS.gold, dpr }, "MONUMENT");
  els.title.replaceChildren(title.el);
  const head = make(doc, "p", "monument-head");
  const name = make(doc, "span", "name");
  const sha = make(doc, "code", "sha");
  head.appendChild(name);
  head.appendChild(sha);
  const list = make(doc, "ol", "stepper");
  const views: StepView[] = [0, 1, 2, 3, 4].map(() => {
    const li = make(doc, "li", "step");
    const mark = createPixelText(doc, { scale: 1, color: TOKENS.faint, dpr, className: "node" });
    const label = createPixelText(doc, { scale: 1, color: TOKENS.faint, dpr, className: "step-label" });
    const detail = make(doc, "span", "detail");
    li.appendChild(mark.el);
    li.appendChild(label.el);
    li.appendChild(detail);
    list.appendChild(li);
    return { li, mark, label, detail };
  });
  const empty = make(doc, "p", "empty", "No integration yet.");
  els.body.replaceChildren(head, list, empty);
  return {
    update(snapshot, nowMs) {
      // The scene's rule, so the panel names the integration the scene and its caption show.
      const integration = featuredIntegration(snapshot);
      head.hidden = integration === null;
      list.hidden = integration === null;
      empty.hidden = integration !== null;
      if (!integration) return;
      name.textContent = integration.name;
      sha.textContent = integration.headSha.slice(0, 7);
      monumentSteps(integration, nowMs).forEach((s, i) => {
        const view = views[i];
        if (!view) return;
        view.li.setAttribute("data-state", s.state);
        view.mark.set(s.mark, STEP_COLORS[s.state]);
        view.label.set(s.label, STEP_COLORS[s.state]);
        view.detail.textContent = s.detail;
      });
    },
  };
}
