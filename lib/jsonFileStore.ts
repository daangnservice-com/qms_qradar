import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

function firstJsonObjectEnd(raw: string): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `.data/<name>/state.json` 파일 락 스토어. STT 배치와 같은 프로세스 내 직렬화. */
export function createJsonFileStore<T>(opts: {
  name: string;
  empty: () => T;
  prepareSave?: (state: T) => T;
}) {
  const DIR = path.join(process.cwd(), ".data", opts.name);
  const FILE = path.join(DIR, "state.json");
  const LOCK = path.join(DIR, "state.json.lock");
  let chain: Promise<unknown> = Promise.resolve();

  async function acquireFileLock(): Promise<() => Promise<void>> {
    await mkdir(DIR, { recursive: true });
    for (let i = 0; i < 400; i++) {
      try {
        const st = await stat(LOCK);
        if (Date.now() - st.mtimeMs > 20_000) await unlink(LOCK).catch(() => {});
      } catch {
        /* no lock */
      }
      try {
        await writeFile(LOCK, String(process.pid), { flag: "wx" });
        return async () => {
          await unlink(LOCK).catch(() => {});
        };
      } catch {
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    throw new Error(`${opts.name} store lock timeout`);
  }

  function withLock<R>(fn: () => Promise<R>): Promise<R> {
    const next = chain.then(
      async () => {
        const release = await acquireFileLock();
        try {
          return await fn();
        } finally {
          await release();
        }
      },
      async () => {
        const release = await acquireFileLock();
        try {
          return await fn();
        } finally {
          await release();
        }
      },
    );
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function load(): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(FILE, "utf8");
    } catch {
      return opts.empty();
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      const end = firstJsonObjectEnd(raw);
      if (end < 0) throw new Error(`${opts.name} state.json is not valid JSON`);
      return JSON.parse(raw.slice(0, end + 1)) as T;
    }
  }

  async function save(state: T): Promise<void> {
    await mkdir(DIR, { recursive: true });
    const payload = JSON.stringify(opts.prepareSave ? opts.prepareSave(state) : state, null, 2);
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, payload, "utf8");
    try {
      await rename(tmp, FILE);
    } catch {
      await copyFile(tmp, FILE);
      await unlink(tmp).catch(() => {});
    }
  }

  return { DIR, FILE, withLock, load, save };
}
