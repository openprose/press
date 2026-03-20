import { describe, it, expect } from "vitest";
import { press } from "../src/rlm.js";
import { fromOpenRouter } from "../eval/drivers/openrouter.js";

// Skip if no API key
const apiKey = process.env.OPENROUTER_API_KEY;
const describeIf = apiKey ? describe : describe.skip;

describeIf("Press smoke test (live API)", () => {
  it("raw loop: trivial math task", async () => {
    const callLLM = fromOpenRouter(
      "google/gemini-2.0-flash-001",  // cheap model
      apiKey!,
      {}
    );

    const result = await press("What is 7 * 8? Return ONLY the number.", undefined, {
      callLLM,
      maxIterations: 5,
      maxDepth: 1,
    });

    expect(result.answer).toContain("56");
    expect(result.iterations).toBeGreaterThanOrEqual(1);
    expect(result.iterations).toBeLessThanOrEqual(5);
  }, 60_000);  // 60 second timeout
});
