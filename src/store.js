import { readFile, writeFile, mkdir, open, unlink, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
export const DATA_DIR = join(ROOT, 'data');
export const DB_FILE = join(DATA_DIR, 'store.json');
const LOCK_FILE = join(DATA_DIR, 'alert-worker.lock');
let writeQueue = Promise.resolve();

export const emptyStore = () => ({ snapshots: [], watchlist: [], alerts: [] });

export async function loadStore() {
  await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) return emptyStore();
  const parsed = JSON.parse(await readFile(DB_FILE, 'utf8'));
  return { ...emptyStore(), ...parsed, alerts: parsed.alerts || [] };
}

export function saveStore(store) {
  writeQueue = writeQueue.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const temp = `${DB_FILE}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(store, null, 2), 'utf8');
    await rename(temp, DB_FILE);
  });
  return writeQueue;
}

export async function acquireWorkerLease(staleAfterMs = 10 * 60 * 1000) {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const handle = await open(LOCK_FILE, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
    await handle.close();
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      const lock = JSON.parse(await readFile(LOCK_FILE, 'utf8'));
      if (Date.now() - new Date(lock.acquiredAt).getTime() > staleAfterMs) {
        await unlink(LOCK_FILE);
        return acquireWorkerLease(staleAfterMs);
      }
    } catch (_) { return false; }
    return false;
  }
}

export async function releaseWorkerLease() {
  try { await unlink(LOCK_FILE); } catch (_) { /* already released */ }
}
