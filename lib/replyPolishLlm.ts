import { GoogleGenerativeAI } from "@google/generative-ai";
import { logLlmCall } from "./llmCallLog";
import { renderReplyPolishPrompt } from "./replyPolishPrompt";

function stripFence(text: string): string {
  let out = text.trim();
  if (out.startsWith("```")) {
    out = out.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/\s*```$/, "");
  }
  return out.trim();
}

export async function polishReplyWithGemini(input: {
  templateBody: string;
  inquiry: string;
  answer: string;
  category: string;
  conversationId?: string | null;
  templateKey?: string | null;
}): Promise<{ text: string; llmCallId: string | null; latencyMs: number; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const prompt = renderReplyPolishPrompt(input.templateBody, {
    inquiry: input.inquiry,
    answer: input.answer,
    category: input.category,
  });
  if (!prompt.trim()) throw new Error("렌더된 프롬프트가 비어 있습니다");

  const genAI = new GoogleGenerativeAI(apiKey);
  const gm = genAI.getGenerativeModel({ model });
  const t0 = Date.now();
  try {
    const result = await gm.generateContent(prompt);
    const latencyMs = Date.now() - t0;
    const text = stripFence(result.response.text());
    if (!text) throw new Error("LLM이 빈 답변을 반환했습니다");
    const usage = result.response.usageMetadata;
    const llmCallId = await logLlmCall({
      purpose: "reply_polish",
      conversationId: input.conversationId ?? null,
      meta: {
        model,
        templateKey: input.templateKey ?? null,
        latencyMs,
        promptTokenCount: usage?.promptTokenCount ?? null,
        candidatesTokenCount: usage?.candidatesTokenCount ?? null,
        totalTokenCount: usage?.totalTokenCount ?? null,
      },
    });
    return { text, llmCallId, latencyMs, model };
  } catch (error) {
    const latencyMs = Date.now() - t0;
    const errMsg = error instanceof Error ? error.message : String(error);
    await logLlmCall({
      purpose: "reply_polish",
      conversationId: input.conversationId ?? null,
      meta: {
        model,
        templateKey: input.templateKey ?? null,
        latencyMs,
        error: errMsg,
      },
    });
    throw error;
  }
}
