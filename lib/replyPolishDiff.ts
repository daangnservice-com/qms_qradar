import { diffChars } from "diff";

export type ReplyPolishDiffPart = {
  value: string;
  added?: boolean;
  removed?: boolean;
};

/** 한국어 포함 평문 비교. 문자 단위라 조사·어미 차이도 잡힌다. */
export function diffReplyPolishText(left: string, right: string): ReplyPolishDiffPart[] {
  return diffChars(left ?? "", right ?? "").map((part) => ({
    value: part.value,
    ...(part.added ? { added: true } : {}),
    ...(part.removed ? { removed: true } : {}),
  }));
}
