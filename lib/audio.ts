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
export async function transcodeToWav(inputPath: string, channels = 1): Promise<string> {
  const outPath = `${inputPath.replace(/\.[^.]+$/, "")}-${channels}ch-${Date.now()}.wav`;
  const args = ["-y", "-i", inputPath, "-ac", String(channels), "-ar", "16000", outPath];
  await new Promise<void>((resolve, reject) => {
    let err = "";
    const proc = spawn(ffmpegPath as string, args);
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        // [임시 진단] 소스 오디오 채널(듀얼채널이면 상담원/고객 분리 가능) — ffmpeg 입력 스트림 정보에서 파싱.
        const m = err.match(/Audio:[^\n]*?(mono|stereo|(\d+) channels)/i);
        console.log("[audio] source channels:", m ? m[1] : "unknown");
        resolve();
      } else {
        reject(new Error(`ffmpeg 변환 실패 (${code}): ${err.slice(-500)}`));
      }
    });
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
