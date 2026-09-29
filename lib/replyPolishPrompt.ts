import { renderTemplate } from "./promptRender";

export function renderReplyPolishPrompt(
  body: string,
  vars: { inquiry: string; answer: string; category: string },
): string {
  return renderTemplate(body, {
    inquiry: vars.inquiry,
    answer: vars.answer,
    category: vars.category,
  });
}
