import { describe, expect, it } from "vitest";
import { defaultPromptSeed } from "./promptDefaults";

describe("text channel prompt defaults", () => {
  it("does not implicitly enable the legacy phone checklist", () => {
    for (const key of ["feedback_eval", "chatcs_eval"] as const) {
      const seed = defaultPromptSeed(key);
      expect(seed.useChecklist).toBe(false);
      expect(seed.selectedCriterionIds).toEqual([]);
      expect(seed.outputSchemaConfig.includeCsChecklist).toBe(false);
      expect(seed.outputSchemaConfig.includeSilenceComments).toBe(false);
      expect(seed.outputSchemaConfig.includeAgentSpeakerTag).toBe(false);
      expect(seed.basePrompt).toContain("텍스트 대화");
    }
  });
});
