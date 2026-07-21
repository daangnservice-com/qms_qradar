// 업로드 이미지 허용 형식(확장자 → MIME). 파손 판별/피드백/챗봇 라우트에서 공용.
export const ALLOWED_IMAGE_MIME = new Map<string, string>([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

export function extOf(name: string): string {
  return name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
}

export function imageMimeOf(name: string): string | undefined {
  return ALLOWED_IMAGE_MIME.get(extOf(name));
}
