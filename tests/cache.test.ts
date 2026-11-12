import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LeadCache } from "../src/cache.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("LeadCache", () => {
  it("expires cached channel data after its configured lifetime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yt-cache-"));
    directories.push(directory);
    const cache = await LeadCache.open(join(directory, "cache.json"));
    await cache.set(
      "channel-id",
      "@creator",
      {
        input: "@creator",
        name: "Creator",
        handle: "@creator",
        subs: 100,
        uploads30: 0,
        avgComments: 0,
        totalComments5: 0,
        commentEnabledVideos: 0,
        creatorReplies: 0,
        description: "",
        url: "https://youtube.com/channel/channel-id",
      },
      0,
    );

    expect(cache.getChannel("channel-id")).toBeUndefined();
    expect(cache.getAlias("@creator")).toBeUndefined();
  });

  it("keeps independently opened cache files isolated", async () => {
    const firstDirectory = await mkdtemp(join(tmpdir(), "yt-cache-one-"));
    const secondDirectory = await mkdtemp(join(tmpdir(), "yt-cache-two-"));
    directories.push(firstDirectory, secondDirectory);
    const first = await LeadCache.open(join(firstDirectory, "cache.json"));
    const second = await LeadCache.open(join(secondDirectory, "cache.json"));
    await first.set(
      "channel-id",
      "@creator",
      {
        input: "@creator",
        name: "Creator",
        handle: "@creator",
        subs: 100,
        uploads30: 0,
        avgComments: 0,
        totalComments5: 0,
        commentEnabledVideos: 0,
        creatorReplies: 0,
        description: "",
        url: "https://youtube.com/channel/channel-id",
      },
      60_000,
    );

    expect(second.getChannel("channel-id")).toBeUndefined();
  });
});
