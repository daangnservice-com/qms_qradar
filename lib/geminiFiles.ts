import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

export interface GeminiFilePart {
  fileData: { fileUri: string; mimeType: string };
}

// 이미지들을 Gemini File API에 업로드하고 ACTIVE 상태까지 대기(이미지 간 병렬).
// 업로드된 파일명은 uploadedNames에 즉시 push하므로, 일부가 실패해도 호출부의
// finally에서 uploadedNames로 정리(deleteFile)할 수 있다.
export async function uploadImagesForGemini(
  fileManager: GoogleAIFileManager,
  images: { path: string; mimeType: string }[],
  uploadedNames: string[],
): Promise<GeminiFilePart[]> {
  return Promise.all(
    images.map(async (img, i) => {
      const up = await fileManager.uploadFile(img.path, { mimeType: img.mimeType, displayName: `img-${i}` });
      uploadedNames.push(up.file.name);
      let file = await fileManager.getFile(up.file.name);
      let attempts = 0;
      while (file.state === FileState.PROCESSING) {
        if (attempts >= 30)
          throw new Error(
            "Gemini 이미지 처리 시간 초과 — 업로드한 이미지가 약 30초 안에 처리 준비되지 않았어요. 이미지가 너무 크거나 네트워크가 느릴 수 있어요. 더 작은 이미지로 시도해 주세요.",
          );
        await new Promise((r) => setTimeout(r, 1000));
        file = await fileManager.getFile(up.file.name);
        attempts++;
      }
      if (file.state === FileState.FAILED) throw new Error("Gemini 이미지 처리 실패");
      return { fileData: { fileUri: file.uri, mimeType: file.mimeType } };
    }),
  );
}
