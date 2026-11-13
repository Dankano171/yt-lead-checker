import { readJson, atomicWriteJson } from "./storage.js";
import type { LeadMetrics } from "./scoring.js";

interface CacheEntry {
  expiresAt: number;
  metrics: LeadMetrics;
}

interface CacheFile {
  channels: Record<string, CacheEntry>;
  aliases: Record<string, { channelId: string; expiresAt: number }>;
}

export class LeadCache {
  private constructor(
    private readonly path: string,
    private readonly data: CacheFile,
  ) {}

  static async open(path: string): Promise<LeadCache> {
    const data = await readJson<CacheFile>(path, { channels: {}, aliases: {} });
    if (
      !data ||
      !data.channels ||
      typeof data.channels !== "object" ||
      Array.isArray(data.channels) ||
      !data.aliases ||
      typeof data.aliases !== "object" ||
      Array.isArray(data.aliases)
    ) {
      return new LeadCache(path, { channels: {}, aliases: {} });
    }
    return new LeadCache(path, data);
  }

  getChannel(channelId: string, now = Date.now()): LeadMetrics | undefined {
    const entry = this.data.channels[channelId];
    if (!entry || entry.expiresAt <= now) {
      delete this.data.channels[channelId];
      return undefined;
    }
    if (typeof entry.metrics.totalComments !== "number") {
      delete this.data.channels[channelId];
      return undefined;
    }
    return entry.metrics;
  }

  getAlias(alias: string, now = Date.now()): string | undefined {
    const entry = this.data.aliases[alias];
    if (!entry || entry.expiresAt <= now) {
      delete this.data.aliases[alias];
      return undefined;
    }
    return entry.channelId;
  }

  async set(
    channelId: string,
    alias: string,
    metrics: LeadMetrics,
    ttlMs: number,
  ): Promise<void> {
    const expiresAt = Date.now() + ttlMs;
    this.data.channels[channelId] = { expiresAt, metrics };
    this.data.aliases[alias] = { channelId, expiresAt };
    await atomicWriteJson(this.path, this.data);
  }
}
