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
    ]) {
      expect(typeof (stream as Record<string, unknown>)[name], name).toBe("function");
    }
  });
});
