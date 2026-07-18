import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function saveTempFile(bytes: Uint8Array, ext: string): Promise<string> {
  const name = `cqe-${process.pid}-${Date.now()}-${Math.floor(performance.now() * 1000)}${ext}`;
  const filePath = path.join(tmpdir(), name);
  await writeFile(filePath, bytes);
  return filePath;
}

export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // 이미 없으면 무시
  }
}
