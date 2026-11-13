import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeadCache } from "../src/cache.js";
import { checkLeads } from "../src/checker.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { DailyQuota } from "../src/quota.js";
import { YouTubeClient } from "../src/youtube.js";
import type { Config } from "../src/types.js";

const channelId = `UC${"a".repeat(22)}`;
const now = new Date("2025-01-30T00:00:00.000Z");
const temporaryDirectories: string[] = [];

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "yt-lead-checker-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(
  fetchImpl: typeof fetch,
  budget: Awaited<ReturnType<typeof DailyQuota.open>>,
): YouTubeClient {
  return new YouTubeClient({
    apiKey: "test-key-not-a-google-key",
    budget,
    retries: 0,
    retryBaseDelayMs: 0,
    fetchImpl,
    sleep: async () => undefined,
  });
}

async function run(
  directory: string,
  client: YouTubeClient,
  options: {
    inputs?: string[];
    refresh?: boolean;
    maxSearch?: number;
    config?: Config;
  } = {},
) {
  return checkLeads({
    inputs: options.inputs ?? [channelId],
    config: options.config ?? DEFAULT_CONFIG,
    client,
    cache: await LeadCache.open(join(directory, "cache.json")),
    outputPath: join(directory, "results.json"),
    csvPath: join(directory, "results.csv"),
    refresh: options.refresh ?? false,
    allowSearch: false,
    maxSearch: options.maxSearch ?? 20,
    concurrency: 1,
    now: () => now,
  });
}

describe("checkLeads", () => {
  it("runs a mocked full API check without persisting raw comment text", async () => {
    const directory = await makeDirectory();
    const quota = await DailyQuota.open(
      join(directory, "usage.json"),
      9000,
      now,
    );
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/channels")) {
        return jsonResponse({
          items: [
            {
              id: channelId,
              snippet: {
                title: "Creator",
                customUrl: "@creator",
                description:
                  "Patreon https://example.com contact creator@example.com",
              },
              statistics: { subscriberCount: "50000" },
              contentDetails: { relatedPlaylists: { uploads: "uploads-id" } },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/playlistItems")) {
        return jsonResponse({
          items: Array.from({ length: 5 }, (_, index) => ({
            contentDetails: { videoId: `video-${index}` },
          })),
        });
      }
      if (url.pathname.endsWith("/videos")) {
        return jsonResponse({
          items: Array.from({ length: 5 }, (_, index) => ({
            id: `video-${index}`,
            snippet: {
              publishedAt: new Date(
                now.getTime() - index * 86400000,
              ).toISOString(),
            },
            statistics: { commentCount: String(200 + index) },
            contentDetails: { duration: "PT2M" },
          })),
        });
      }
      if (url.pathname.endsWith("/commentThreads")) {
        return jsonResponse({
          items: Array.from({ length: 3 }, () => ({
            replies: {
              comments: [
                {
                  snippet: {
                    authorChannelId: { value: channelId },
                    textDisplay: "private raw comment",
                  },
                },
              ],
            },
          })),
        });
      }
      return jsonResponse({ items: [] });
    });

    const result = await run(directory, makeClient(fetchImpl, quota));
    const cache = await readFile(join(directory, "cache.json"), "utf8");

    expect(result.results[0]?.status).toBe("PASS");
    expect(result.results[0]?.score).toBe(10);
    expect(result.results[0]?.totalComments).toBe(1010);
    expect(result.results[0]?.creatorReplies).toBe(3);
    expect(result.results[0]?.emailInDescription).toBe("creator@example.com");
    expect(result.stopped).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const videoRequest = fetchImpl.mock.calls
      .map(([input]) => new URL(input.toString()))
      .find((url) => url.pathname.endsWith("/videos"));
    expect(videoRequest?.searchParams.get("part")).toBe(
      "snippet,statistics,contentDetails",
    );
    expect(cache).not.toContain("private raw comment");
    expect(await readFile(join(directory, "results.csv"), "utf8")).toContain(
      "creator@example.com",
    );
  });

  it("handles comment-disabled videos as a qualification failure", async () => {
    const directory = await makeDirectory();
    const quota = await DailyQuota.open(
      join(directory, "usage.json"),
      9000,
      now,
    );
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/channels")) {
        return jsonResponse({
          items: [
            {
              id: channelId,
              snippet: { title: "No comments" },
              statistics: { subscriberCount: "50000" },
              contentDetails: { relatedPlaylists: { uploads: "uploads" } },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/playlistItems")) {
        return jsonResponse({
          items: [{ contentDetails: { videoId: "video" } }],
        });
      }
      if (url.pathname.endsWith("/videos")) {
        return jsonResponse({
          items: [
            {
              id: "video",
              snippet: { publishedAt: now.toISOString() },
              statistics: { commentCount: "100" },
              contentDetails: { duration: "PT2M" },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/commentThreads")) {
        return jsonResponse(
          {
            error: {
              message: "Comments are disabled",
              errors: [{ reason: "commentsDisabled" }],
            },
          },
          403,
        );
      }
      return jsonResponse({ items: [] });
    });

    const result = await run(directory, makeClient(fetchImpl, quota));

    expect(result.results[0]?.status).toBe("FAIL");
    expect(result.results[0]?.why).toContain("comments disabled");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("counts all eligible videos in the configured window and excludes shorts", async () => {
    const directory = await makeDirectory();
    const quota = await DailyQuota.open(
      join(directory, "usage.json"),
      9000,
      now,
    );
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/channels")) {
        return jsonResponse({
          items: [
            {
              id: channelId,
              snippet: { title: "Many uploads" },
              statistics: { subscriberCount: "50000" },
              contentDetails: { relatedPlaylists: { uploads: "uploads" } },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/playlistItems")) {
        expect(url.searchParams.get("maxResults")).toBe("20");
        return jsonResponse({
          items: Array.from({ length: 20 }, (_, index) => ({
            contentDetails: { videoId: `video-${index}` },
          })),
        });
      }
      if (url.pathname.endsWith("/videos")) {
        return jsonResponse({
          items: Array.from({ length: 20 }, (_, index) => ({
            id: `video-${index}`,
            snippet: {
              publishedAt: new Date(
                now.getTime() - index * 86400000,
              ).toISOString(),
            },
            statistics: { commentCount: index < 7 ? "15" : "1000" },
            contentDetails: {
              duration: index < 7 ? "PT1M10S" : "PT1M9S",
            },
          })),
        });
      }
      return jsonResponse({ items: [] });
    });

    const result = await run(directory, makeClient(fetchImpl, quota));

    expect(result.results[0]?.status).toBe("PASS");
    expect(result.results[0]?.totalComments).toBe(105);
  });

  it("applies the configured comment window and minimum", async () => {
    const directory = await makeDirectory();
    const quota = await DailyQuota.open(
      join(directory, "usage.json"),
      9000,
      now,
    );
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/channels")) {
        return jsonResponse({
          items: [
            {
              id: channelId,
              snippet: { title: "Recent uploads" },
              statistics: { subscriberCount: "50000" },
              contentDetails: { relatedPlaylists: { uploads: "uploads" } },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/playlistItems")) {
        return jsonResponse({
          items: Array.from({ length: 20 }, (_, index) => ({
            contentDetails: { videoId: `video-${index}` },
          })),
        });
      }
      if (url.pathname.endsWith("/videos")) {
        return jsonResponse({
          items: Array.from({ length: 20 }, (_, index) => ({
            id: `video-${index}`,
            snippet: {
              publishedAt: new Date(
                now.getTime() - index * 86400000,
              ).toISOString(),
            },
            statistics: { commentCount: "15" },
            contentDetails: { duration: "PT2M" },
          })),
        });
      }
      return jsonResponse({ items: [] });
    });
    const config: Config = {
      ...DEFAULT_CONFIG,
      thresholds: {
        ...DEFAULT_CONFIG.thresholds,
        uploadsWindowDays: 3,
        minimumTotalComments: 61,
      },
    };

    const result = await run(directory, makeClient(fetchImpl, quota), {
      config,
    });

    expect(result.results[0]?.status).toBe("FAIL");
    expect(result.results[0]?.totalComments).toBe(60);
    expect(result.results[0]?.why).toContain("minimum 61");
    expect(result.results[0]?.why).toContain("in 3 days");
  });

  it("stops at the quota budget and resumes without rechecking completed leads", async () => {
    const directory = await makeDirectory();
    const secondId = `UC${"b".repeat(22)}`;
    const firstQuota = await DailyQuota.open(
      join(directory, "usage.json"),
      1,
      now,
    );
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const requestedId = new URL(input.toString()).searchParams.get("id");
      return jsonResponse({
        items: [
          {
            id: requestedId,
            snippet: { title: "No uploads" },
            statistics: { subscriberCount: "10000" },
            contentDetails: { relatedPlaylists: {} },
          },
        ],
      });
    });

    const partial = await checkLeads({
      inputs: [channelId, secondId],
      config: DEFAULT_CONFIG,
      client: makeClient(fetchImpl, firstQuota),
      cache: await LeadCache.open(join(directory, "cache.json")),
      outputPath: join(directory, "results.json"),
      csvPath: join(directory, "results.csv"),
      refresh: false,
      allowSearch: false,
      maxSearch: 20,
      concurrency: 1,
      now: () => now,
    });
    expect(partial.stopped).toBe("budget");
    expect(partial.results.map((result) => result.input)).toEqual([channelId]);

    const nextQuota = await DailyQuota.open(
      join(directory, "usage.json"),
      20,
      now,
    );
    const resumed = await checkLeads({
      inputs: [channelId, secondId],
      config: DEFAULT_CONFIG,
      client: makeClient(fetchImpl, nextQuota),
      cache: await LeadCache.open(join(directory, "cache.json")),
      outputPath: join(directory, "results.json"),
      csvPath: join(directory, "results.csv"),
      refresh: false,
      allowSearch: false,
      maxSearch: 20,
      concurrency: 1,
      now: () => now,
    });

    expect(resumed.results).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const savedRun = JSON.parse(
      await readFile(join(directory, "results.json"), "utf8"),
    ) as {
      results: unknown[];
    };
    expect(savedRun.results).toHaveLength(2);
  });

  it("writes results safely when concurrency is greater than one", async () => {
    const directory = await makeDirectory();
    const secondId = `UC${"c".repeat(22)}`;
    const quota = await DailyQuota.open(
      join(directory, "usage.json"),
      9000,
      now,
    );
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      jsonResponse({
        items: [
          {
            id: new URL(input.toString()).searchParams.get("id"),
            snippet: { title: "No uploads" },
            statistics: { subscriberCount: "10000" },
            contentDetails: { relatedPlaylists: {} },
          },
        ],
      }),
    );

    const result = await checkLeads({
      inputs: [channelId, secondId],
      config: DEFAULT_CONFIG,
      client: makeClient(fetchImpl, quota),
      cache: await LeadCache.open(join(directory, "cache.json")),
      outputPath: join(directory, "results.json"),
      csvPath: join(directory, "results.csv"),
      refresh: false,
      allowSearch: false,
      maxSearch: 20,
      concurrency: 2,
      now: () => now,
    });

    expect(result.results).toHaveLength(2);
    expect(
      JSON.parse(await readFile(join(directory, "results.json"), "utf8"))
        .results,
    ).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("redacts an API key from errors", async () => {
    const directory = await makeDirectory();
    const quota = await DailyQuota.open(
      join(directory, "usage.json"),
      9000,
      now,
    );
    const client = new YouTubeClient({
      apiKey: "test-private-api-key",
      budget: quota,
      retries: 0,
      retryBaseDelayMs: 0,
      fetchImpl: async () =>
        jsonResponse(
          { error: { message: "invalid key test-private-api-key" } },
          500,
        ),
    });

    await expect(client.channelsById(channelId)).rejects.toThrow(
      "invalid key [REDACTED]",
    );
  });
});
