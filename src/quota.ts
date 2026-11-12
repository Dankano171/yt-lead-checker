import { readFile } from "node:fs/promises";
import type { QuotaBudget } from "./types.js";
import { atomicWriteJson, ensureParentDirectory } from "./storage.js";

interface UsageLog {
  day: string;
  units: number;
}

export class BudgetExceededError extends Error {
  constructor() {
    super("Configured daily quota budget reached.");
    this.name = "BudgetExceededError";
  }
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export class DailyQuota implements QuotaBudget {
  private units = 0;
  private readonly day: string;
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly limit: number,
    day: string,
    units: number,
  ) {
    this.day = day;
    this.units = units;
  }

  static async open(
    path: string,
    limit: number,
    now = new Date(),
  ): Promise<DailyQuota> {
    const today = utcDay(now);
    let units = 0;
    try {
      const log = JSON.parse(await readFile(path, "utf8")) as Partial<UsageLog>;
      if (
        log.day === today &&
        typeof log.units === "number" &&
        log.units >= 0
      ) {
        units = log.units;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await ensureParentDirectory(path);
    return new DailyQuota(path, limit, today, units);
  }

  get used(): number {
    return this.units;
  }

  async consume(units: number): Promise<void> {
    if (this.units + units > this.limit) throw new BudgetExceededError();
    this.units += units;
    const snapshot = { day: this.day, units: this.units } satisfies UsageLog;
    this.writeChain = this.writeChain.then(() =>
      atomicWriteJson(this.path, snapshot),
    );
    await this.writeChain;
  }
}

export async function readQuota(
  path: string,
  now = new Date(),
): Promise<number> {
  try {
    const log = JSON.parse(await readFile(path, "utf8")) as Partial<UsageLog>;
    return log.day === utcDay(now) &&
      typeof log.units === "number" &&
      Number.isFinite(log.units) &&
      log.units >= 0
      ? log.units
      : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}
