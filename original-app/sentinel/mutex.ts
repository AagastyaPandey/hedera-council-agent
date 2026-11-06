/**
 * sentinel/mutex.ts
 *
 * Cross-process lock for operations that take an EVM snapshot on a shared
 * node (preview simulation, Sentinel simulation, the Red-Team Arena runner).
 * Two snapshots must never interleave, or `evm_revert` restores another
 * caller's state.
 *
 * Reentrant within a process; file-based across processes. Stale locks whose
 * owner PID is gone are broken automatically.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const STALE_MS = 10 * 60 * 1000;

let held = 0;
let heldFile: string | null = null;

export interface SnapshotLockOptions {
  label?: string;
  timeoutMs?: number;
  pollMs?: number;
  lockPath?: string;
}

function repositoryRoot(): string {
  const override = process.env.AEGIS_REPO_ROOT;
  if (override) return path.resolve(override);
  const candidates = [process.cwd(), __dirname];
  for (const start of candidates) {
    let dir = path.resolve(start);
    for (let depth = 0; depth < 6; depth++) {
      if (
        fs.existsSync(path.join(dir, "hardhat.config.ts")) &&
        fs.existsSync(path.join(dir, "packages", "shared"))
      ) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("Could not locate the repository root for the snapshot lock");
}

export function defaultLockPath(): string {
  return path.join(
    repositoryRoot(),
    "packages",
    "shared",
    "fixtures",
    "snapshot.lock"
  );
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` while holding the shared snapshot lock. Reentrant: a nested call in
 * the same process reuses the held lock.
 */
export async function withSnapshotLock<T>(
  fn: () => Promise<T>,
  options: SnapshotLockOptions = {}
): Promise<T> {
  if (held > 0) {
    held += 1;
    try {
      return await fn();
    } finally {
      held -= 1;
    }
  }

  const file = options.lockPath ?? defaultLockPath();
  const timeoutMs = options.timeoutMs ?? 180_000;
  const pollMs = options.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  fs.mkdirSync(path.dirname(file), { recursive: true });

  for (;;) {
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({
          pid: process.pid,
          label: options.label ?? "snapshot",
          startedAt: new Date().toISOString(),
        }),
        { encoding: "utf8", flag: "wx" }
      );
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      let owner: number | null = null;
      let startedAt = 0;
      try {
        const contents = JSON.parse(fs.readFileSync(file, "utf8")) as {
          pid?: number;
          startedAt?: string;
        };
        owner = Number(contents.pid) || null;
        startedAt = Date.parse(contents.startedAt ?? "") || 0;
      } catch {
        // Corrupt or partially written lock: treat it as stale.
      }

      const stale = startedAt > 0 && Date.now() - startedAt > STALE_MS;
      if (!owner || !processAlive(owner) || stale) {
        fs.rmSync(file, { force: true });
        continue;
      }

      if (Date.now() > deadline) {
        throw new Error(
          `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the ` +
            `snapshot lock (${file}) held by pid ${owner}`
        );
      }
      await sleep(pollMs);
    }
  }

  held = 1;
  heldFile = file;
  try {
    return await fn();
  } finally {
    held = 0;
    if (heldFile) {
      try {
        const contents = JSON.parse(fs.readFileSync(heldFile, "utf8")) as {
          pid?: number;
        };
        if (contents.pid === process.pid) fs.rmSync(heldFile, { force: true });
      } catch {
        // Best effort.
      }
      heldFile = null;
    }
  }
}