// Tests the public surface of src/stream/index.ts.
import { describe, expect, it } from "vitest";
import * as stream from "./index";

describe("src/stream index", () => {
  it("exports every function the module promises", () => {
    for (const name of [
      "parseStream",
      "digestStream",
      "failureCause",
      "rateLimitFromEvent",
      "classifyAttempt",
      "findTranscript",
      "measuredEffort",
      "buildAttemptSummary",
      "toolUses",
    ]) {
      expect(typeof (stream as Record<string, unknown>)[name], name).toBe("function");
    }
  });

  it("exports the report tool's name", () => {
    expect(stream.REPORT_TOOL).toBe("StructuredOutput");
  });
});
