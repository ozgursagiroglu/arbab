import type { JsonSchema, Role } from "../types";

// Default report schemas per role (DESIGN.md §6). Only the top level forbids additional properties.

const str: JsonSchema = { type: "string" };
const strings: JsonSchema = { type: "array", items: str };

const workerReport: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["done", "partial", "blocked"] },
    summary: str,
    files_changed: strings,
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: { command: str, exit_code: { type: "integer" }, result: str },
        required: ["command", "exit_code", "result"],
      },
    },
    decisions: strings,
    open_questions: strings,
    not_verified: strings,
    notes_for_reviewer: str,
  },
  required: ["status", "summary", "files_changed", "checks", "decisions", "open_questions", "not_verified"],
};

const reviewerReport: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: str,
          severity: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          file: str,
          line: { type: "integer" },
          failure_scenario: str,
          evidence: str,
        },
        required: ["title", "severity", "file", "failure_scenario", "evidence"],
      },
    },
    coverage: str,
    paths_checked: strings,
  },
  required: ["findings", "coverage", "paths_checked"],
};

const researcherReport: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: str,
          claim: str,
          source: str,
          quote: str,
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["question", "claim", "source", "confidence"],
      },
    },
    not_found: strings,
    recommendations: strings,
  },
  required: ["facts", "not_found", "recommendations"],
};

const probeReport: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        // Preflight judges a probe by each step's exit code (src/commands/preflight.ts).
        properties: { n: { type: "integer" }, command: str, exit_code: { type: "integer" }, output: str },
        required: ["n", "command", "exit_code", "output"],
      },
    },
  },
  required: ["steps"],
};

export const DEFAULT_SCHEMAS: Readonly<Record<Role, JsonSchema>> = Object.freeze({
  implementer: workerReport,
  verifier: workerReport,
  reviewer: reviewerReport,
  researcher: researcherReport,
  probe: probeReport,
});
