import { writeFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

export async function saveTempFile(bytes: Uint8Array, ext: string): Promise<string> {
  const name = `cqe-${process.pid}-${Date.now()}-${Math.floor(performance.now() * 1000)}${ext}`;
  const filePath = path.join(tmpdir(), name);
  await writeFile(filePath, bytes);
  return filePath;
}

// Genesys 녹취는 WEBM(Opus) 등 Gemini File API가 보장하지 않는 포맷일 수 있어,
// ffmpeg로 wav(16kHz mono)로 정규화한다. 이 wav로 무음분석 + Gemini 업로드를 모두 수행.
export async function transcodeToWav(inputPath: string): Promise<string> {
  const outPath = `${inputPath.replace(/\.[^.]+$/, "")}-${Date.now()}.wav`;
  const args = ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", outPath];
  await new Promise<void>((resolve, reject) => {
    let err = "";
    const proc = spawn(ffmpegPath as string, args);
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 변환 실패 (${code}): ${err.slice(-500)}`))));
  });
  return outPath;
}

export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // 이미 없으면 무시
  }
}
