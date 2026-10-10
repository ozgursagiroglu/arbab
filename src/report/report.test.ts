import { describe, expect, it } from "vitest";
import type { JsonSchema } from "../types";
import { ROLES } from "../types";
import { DEFAULT_SCHEMAS, validate } from "./index";

describe("validate", () => {
  it("checks types, with integer distinct from a non-integer number", () => {
    expect(validate({ type: "integer" }, 3)).toEqual([]);
    expect(validate({ type: "integer" }, 3.5)).toEqual([{ path: "", message: "expected integer, got number" }]);
    expect(validate({ type: "number" }, 3)).toEqual([]);
    expect(validate({ type: "number" }, 3.5)).toEqual([]);
    expect(validate({ type: "number" }, "3")).toHaveLength(1);
    expect(validate({ type: "string" }, "x")).toEqual([]);
    expect(validate({ type: "boolean" }, false)).toEqual([]);
    expect(validate({ type: "null" }, null)).toEqual([]);
    expect(validate({ type: "object" }, [])).toEqual([{ path: "", message: "expected object, got array" }]);
    expect(validate({ type: "object" }, null)).toEqual([{ path: "", message: "expected object, got null" }]);
    expect(validate({ type: "array" }, {})).toHaveLength(1);
    expect(validate({}, Symbol("anything"))).toEqual([]);
  });

  it("checks enums", () => {
    const s: JsonSchema = { enum: ["a", 1, null] };
    expect(validate(s, "a")).toEqual([]);
    expect(validate(s, null)).toEqual([]);
    expect(validate(s, "b")).toEqual([{ path: "", message: 'must be one of "a", 1, null' }]);
  });

  it("checks required, additionalProperties and escapes keys in paths", () => {
    const s: JsonSchema = {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a", "b"],
      additionalProperties: false,
    };
    expect(validate(s, { a: "x", "c/d~": 1 })).toEqual([
      { path: "/b", message: "is required" },
      { path: "/c~1d~0", message: "is not an allowed property" },
    ]);
    expect(validate({ type: "object" }, { anything: 1 })).toEqual([]);
  });

  it("does not treat inherited names as properties", () => {
    expect(validate({ type: "object", required: ["toString"] }, {})).toEqual([
      { path: "/toString", message: "is required" },
    ]);
    expect(validate({ type: "object", additionalProperties: false }, { constructor: 1 })).toHaveLength(1);
  });

  it("checks items and minItems", () => {
    const s: JsonSchema = { type: "array", minItems: 2, items: { type: "integer" } };
    expect(validate(s, [1, 2])).toEqual([]);
    expect(validate(s, ["x"])).toEqual([
      { path: "", message: "must have at least 2 items, got 1" },
      { path: "/0", message: "expected integer, got string" },
    ]);
  });

  it("stops at a node of the wrong type", () => {
    const s: JsonSchema = { type: "object", required: ["a"] };
    expect(validate(s, "x")).toHaveLength(1);
  });
});

const validImplementer = {
  status: "done",
  summary: "s",
  files_changed: ["a.ts"],
  checks: [{ command: "pnpm test", exit_code: 0, result: "ok" }],
  decisions: [],
  open_questions: [],
  not_verified: [],
};

describe("DEFAULT_SCHEMAS", () => {
  it("has a top-level object schema for every role", () => {
    for (const r of ROLES) {
      expect(DEFAULT_SCHEMAS[r].type).toBe("object");
      expect(DEFAULT_SCHEMAS[r].additionalProperties).toBe(false);
    }
  });

  it("forbids additional properties only at the top level", () => {
    for (const r of ROLES) {
      for (const prop of Object.values(DEFAULT_SCHEMAS[r].properties ?? {})) {
        expect(prop.items?.additionalProperties).toBeUndefined();
      }
    }
    const report = { ...validImplementer, checks: [{ command: "c", exit_code: 0, result: "r", extra: 1 }] };
    expect(validate(DEFAULT_SCHEMAS.implementer, report)).toEqual([]);
  });

  it("accepts and rejects implementer and verifier reports", () => {
    for (const r of ["implementer", "verifier"] as const) {
      const s = DEFAULT_SCHEMAS[r];
      expect(validate(s, validImplementer)).toEqual([]);
      expect(validate(s, { ...validImplementer, notes_for_reviewer: "n" })).toEqual([]);
      const bad = {
        ...validImplementer,
        status: "finished",
        checks: [{ command: "x", exit_code: 1.5, result: "r" }, { command: "y", result: "r" }],
        extra: true,
      };
      delete (bad as Record<string, unknown>).summary;
      expect(validate(s, bad)).toEqual([
        { path: "/summary", message: "is required" },
        { path: "/status", message: 'must be one of "done", "partial", "blocked"' },
        { path: "/checks/0/exit_code", message: "expected integer, got number" },
        { path: "/checks/1/exit_code", message: "is required" },
        { path: "/extra", message: "is not an allowed property" },
      ]);
    }
  });

  it("accepts and rejects reviewer reports", () => {
    const s = DEFAULT_SCHEMAS.reviewer;
    const finding = { title: "t", severity: "HIGH", file: "a.ts", failure_scenario: "f", evidence: "e" };
    const ok = { findings: [finding, { ...finding, line: 3 }], coverage: "all", paths_checked: ["src"] };
    expect(validate(s, ok)).toEqual([]);
    expect(validate(s, { findings: [{ ...finding, severity: "high", line: "3" }], paths_checked: [1] })).toEqual([
      { path: "/coverage", message: "is required" },
      { path: "/findings/0/severity", message: 'must be one of "HIGH", "MEDIUM", "LOW"' },
      { path: "/findings/0/line", message: "expected integer, got string" },
      { path: "/paths_checked/0", message: "expected string, got integer" },
    ]);
  });

  it("accepts and rejects researcher reports", () => {
    const s = DEFAULT_SCHEMAS.researcher;
    const fact = { question: "q", claim: "c", source: "https://example.com", confidence: "high" };
    expect(validate(s, { facts: [fact, { ...fact, quote: "x" }], not_found: [], recommendations: ["r"] })).toEqual([]);
    expect(validate(s, { facts: [{ ...fact, confidence: "certain", source: undefined }], not_found: [] })).toEqual([
      { path: "/recommendations", message: "is required" },
      { path: "/facts/0/source", message: "expected string, got undefined" },
      { path: "/facts/0/confidence", message: 'must be one of "high", "medium", "low"' },
    ]);
  });

  it("accepts and rejects probe reports", () => {
    const s = DEFAULT_SCHEMAS.probe;
    expect(validate(s, { steps: [{ n: 1, command: "ls", exit_code: 0, output: "a.txt" }] })).toEqual([]);
    expect(validate(s, { steps: [{ n: "1", command: "ls" }] })).toEqual([
      { path: "/steps/0/exit_code", message: "is required" },
      { path: "/steps/0/output", message: "is required" },
      { path: "/steps/0/n", message: "expected integer, got string" },
    ]);
    // The old shape, judged by an outcome string, no longer passes: preflight reads exit_code.
    expect(validate(s, { steps: [{ n: 1, command: "ls", outcome: "ok" }] })).toEqual([
      { path: "/steps/0/exit_code", message: "is required" },
      { path: "/steps/0/output", message: "is required" },
    ]);
    expect(validate(s, { steps: [{ n: 1, command: "ls", exit_code: 1.5, output: "" }] })).toEqual([
      { path: "/steps/0/exit_code", message: "expected integer, got number" },
    ]);
    expect(validate(s, null)).toEqual([{ path: "", message: "expected object, got null" }]);
  });
});
