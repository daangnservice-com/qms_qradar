import { describe, expect, it } from "vitest";
import { renderReplyPolishPrompt } from "./replyPolishPrompt";

describe("renderReplyPolishPrompt", () => {
  it("fills inquiry, answer, and category", () => {
    expect(
      renderReplyPolishPrompt("cat={{category}}\nq={{inquiry}}\na={{answer}}", {
        category: "환불",
        inquiry: "환불해 주세요",
        answer: "확인해 볼게요",
      }),
    ).toBe("cat=환불\nq=환불해 주세요\na=확인해 볼게요");
  });

  it("blanks missing keys", () => {
    expect(renderReplyPolishPrompt("{{inquiry}}/{{missing}}", { inquiry: "Q", answer: "A", category: "C" })).toBe(
      "Q/",
    );
  });
});
