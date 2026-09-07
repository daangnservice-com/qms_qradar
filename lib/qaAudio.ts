import { mkdir, access, copyFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { saveTempFile, transcodeToWav, cleanupTempFile } from "./audio";
import { getConversationAudioUrl, downloadAudio } from "./genesys";

const QA_AUDIO_DIR = path.join(process.cwd(), ".data", "qa-audio");

export function qaAudioPath(conversationId: string): string {
  const safe = conversationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(QA_AUDIO_DIR, `${safe}.wav`);
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Genesys → 로컬 `.data/qa-audio/{id}.wav`.
 * keep=true면 기존 파일 재사용. keep=false여도 평가 중에는 파일을 만들고, 호출부가 삭제.
 * STT용 GCS 임시 업로드는 별도(기존 stt.ts).
 */
export async function ensureLocalQaAudio(conversationId: string): Promise<{
  wavPath: string;
  sourcePath: string;
  reused: boolean;
  tempPaths: string[];
}> {
  await mkdir(QA_AUDIO_DIR, { recursive: true });
  const dest = qaAudioPath(conversationId);
  const tempPaths: string[] = [];

  if (await exists(dest)) {
    return { wavPath: dest, sourcePath: dest, reused: true, tempPaths };
  }

  const url = await getConversationAudioUrl(conversationId);
  const { bytes } = await downloadAudio(url);
  const srcPath = await saveTempFile(bytes, ".audio");
  tempPaths.push(srcPath);
  const wavTmp = await transcodeToWav(srcPath, 2);
  tempPaths.push(wavTmp);

  await copyFile(wavTmp, dest);

  return { wavPath: dest, sourcePath: dest, reused: false, tempPaths };
}

/** keep=false일 때 로컬 QA 오디오 삭제 */
export async function removeLocalQaAudio(conversationId: string): Promise<void> {
  await cleanupTempFile(qaAudioPath(conversationId));
}

export async function cleanupPaths(paths: string[]): Promise<void> {
  for (const p of paths) await cleanupTempFile(p);
}

/** 테스트/유틸: 바이트를 직접 저장 */
export async function writeQaAudioBytes(conversationId: string, bytes: Uint8Array): Promise<string> {
  await mkdir(QA_AUDIO_DIR, { recursive: true });
  const dest = qaAudioPath(conversationId);
  await writeFile(dest, bytes);
  return dest;
}

export { unlink };
