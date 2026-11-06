// Fresh code, written 2026-11-06 for ETHGlobal Mumbai.
// Small durable state: council seats (one per World ID nullifier) and
// spent approval keys. World's guidance is to record nullifiers in durable
// storage, not memory, so a restart cannot re-admit a person or replay an
// approval. A JSON file is enough for one agent process.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface CouncilSeat {
  seat: string;
  nullifier: string;
  joinedAt: string;
  source: "world" | "mocked";
}

interface StateShape {
  seats: CouncilSeat[];
  usedApprovals: string[];
}

export class StateStore {
  private state: StateShape = { seats: [], usedApprovals: [] };

  // path null keeps state in memory only (tests).
  constructor(private readonly path: string | null) {
    if (!path) return;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<StateShape>;
      this.state = { seats: raw.seats ?? [], usedApprovals: raw.usedApprovals ?? [] };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.path);
  }

  seats(): CouncilSeat[] {
    return [...this.state.seats];
  }

  // Returns null when this nullifier already holds a seat.
  addSeat(nullifier: string, source: CouncilSeat["source"]): CouncilSeat | null {
    if (this.state.seats.some((s) => s.nullifier === nullifier)) return null;
    const seat: CouncilSeat = {
      seat: `council-seat:${this.state.seats.length + 1}`,
      nullifier,
      joinedAt: new Date().toISOString(),
      source,
    };
    this.state.seats.push(seat);
    this.save();
    return seat;
  }

  // Atomically records an approval key; false if it was already used.
  consumeApproval(key: string): boolean {
    if (this.state.usedApprovals.includes(key)) return false;
    this.state.usedApprovals.push(key);
    this.save();
    return true;
  }
}
