import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { JsonSchema } from "../types";
import { NO_SCHEMA_TEXT, describeSchema, typeName } from "./schema";

describe("typeName", () => {
  it("names enums, arrays, nested arrays and plain types", () => {
    expect(typeName({ type: "string", enum: ["done", "partial"] })).toBe('"done" | "partial"');
    expect(typeName({ type: "array", items: { type: "string" } })).toBe("string[]");
    expect(typeName({ type: "array", items: { type: "string", enum: ["a", "b"] } })).toBe('("a" | "b")[]');
    expect(typeName({ type: "array", items: { type: "array", items: { type: "integer" } } })).toBe("integer[][]");
    expect(typeName({ type: "array" })).toBe("unknown[]");
    expect(typeName({ type: "integer" })).toBe("integer");
    expect(typeName({ properties: {} })).toBe("object");
    expect(typeName({})).toBe("unknown");
  });
});

describe("describeSchema", () => {
  it("returns the summary sentence for no schema", () => {
    expect(describeSchema(null)).toBe(NO_SCHEMA_TEXT);
    expect(NO_SCHEMA_TEXT).toBe("Your final answer is a short summary of what you did and what you could not do.");
  });
  it("lists the implementer schema's fields, with nested object fields indented", () => {
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "bench", "schemas", "implementer.json"), "utf8")) as JsonSchema;
    expect(describeSchema(schema)).toBe([
      '- `status`: `"done" | "partial" | "blocked"`',
      "- `summary`: `string`",
      "- `files_changed`: `string[]`",
      "- `checks`: `object[]`",
      "  - `command`: `string`",
      "  - `exit_code`: `integer`",
      "  - `result`: `string`",
      "- `decisions`: `string[]`",
      "- `open_questions`: `string[]`",
      "- `not_verified`: `string[]`",
      "- `notes_for_reviewer`: `string` (optional)",
    ].join("\n"));
  });
  it("indents nested objects and adds descriptions", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["coverage"],
      properties: {
        coverage: { type: "object", description: "what was\n checked", required: ["paths"], properties: { paths: { type: "array", items: { type: "string" } }, note: { type: "string" } } },
      },
    };
    expect(describeSchema(schema)).toBe([
      "- `coverage`: `object` — what was checked",
      "  - `paths`: `string[]`",
      "  - `note`: `string` (optional)",
    ].join("\n"));
  });
  it("describes a schema without properties as the whole answer", () => {
    expect(describeSchema({ type: "array", items: { type: "string" } })).toBe("- the whole answer: `string[]`");
  });
});
