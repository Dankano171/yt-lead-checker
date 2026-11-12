import type { Config, LeadResult, RunFile, Channel } from "./types.js";
import { LeadCache } from "./cache.js";
import { normalizeInput, parseLeadReference } from "./inputs.js";
import { scoreLead } from "./scoring.js";
import type { LeadMetrics } from "./scoring.js";
import { BudgetExceededError } from "./quota.js";
import {
  QuotaExceededError,
  YouTubeApiError,
  YouTubeClient,
  type CommentThread,
} from "./youtube.js";
import { atomicWriteJson, readJson } from "./storage.js";
import { writeResultsCsv } from "./writer.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CheckOptions {
  inputs: string[];
  config: Config;
  client: YouTubeClient;
  cache: LeadCache;
  outputPath: string;
  csvPath: string;
  refresh: boolean;
  allowSearch: boolean;
  maxSearch: number;
  concurrency: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface CheckSummary {
  results: LeadResult[];
  stopped: "budget" | "quota" | undefined;
  searchCount: number;
}

export async function checkLeads(options: CheckOptions): Promise<CheckSummary> {
  const { inputs, config, client, cache } = options;
  const previous = await readJson<RunFile>(options.outputPath, {
    runAt: "",
    results: [],
  });
  const results = options.refresh
    ? []
    : (previous.results ?? []).filter(
        (result) => result.status === "PASS" || result.status === "FAIL",
      );
  const completed = new Set(
    results.map((result) => normalizeInput(result.input)),
  );
  const seenInputs = new Set<string>();
  const inputItems = inputs.filter((input) => {
    const key = normalizeInput(input);
    if (completed.has(key) || seenInputs.has(key)) return false;
    seenInputs.add(key);
    return true;
  });
  let searchCount = 0;
  let stopped: CheckSummary["stopped"];
  let cursor = 0;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  let flushChain = Promise.resolve();
  const flush = (): Promise<void> => {
    flushChain = flushChain.then(async () => {
      results.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      await atomicWriteJson(options.outputPath, {
        runAt: now().toISOString(),
        results,
      } satisfies RunFile);
      await writeResultsCsv(options.csvPath, results);
    });
    return flushChain;
  };
  const saveResult = (result: LeadResult): void => {
    const existingIndex = results.findIndex(
      (saved) => normalizeInput(saved.input) === normalizeInput(result.input),
    );
    if (existingIndex < 0) results.push(result);
    else results[existingIndex] = result;
  };

  const processOne = async (input: string): Promise<LeadResult> => {
    const normalized = normalizeInput(input);
    const reference = parseLeadReference(input);
    const idFromReference =
      reference.kind === "id" ? reference.value : undefined;
    if (!options.refresh) {
      const cachedAliasId = cache.getAlias(normalized);
      const cached =
        (idFromReference && cache.getChannel(idFromReference)) ??
        (cachedAliasId && cache.getChannel(cachedAliasId));
      if (cached) return scoreLead({ ...cached, input }, config);
    }

    let channel: Channel | undefined;
    if (reference.kind === "id") {
      channel = (await client.channelsById(reference.value)).items?.[0];
    } else if (reference.kind === "handle") {
      channel = (await client.channelsByHandle(reference.value)).items?.[0];
    } else if (options.allowSearch && searchCount < options.maxSearch) {
      searchCount += 1;
      const search = await client.searchChannel(reference.value);
      const channelId =
        search.items?.[0]?.snippet?.channelId ??
        search.items?.[0]?.id?.channelId;
      if (channelId)
        channel = (await client.channelsById(channelId)).items?.[0];
    } else if (options.allowSearch) {
      return {
        input,
        status: "NOT_FOUND",
        why: `search limit reached (${options.maxSearch})`,
      };
    } else {
      return {
        input,
        status: "NOT_FOUND",
        why: "plain names require --search",
      };
    }

    if (!channel) {
      return {
        input,
        status: "NOT_FOUND",
        why: "channel not found or invalid identifier",
      };
    }
    if (!options.refresh) {
      const cached = cache.getChannel(channel.id);
      if (cached) {
        await cache.set(
          channel.id,
          normalized,
          cached,
          config.cacheTtlDays * DAY_MS,
        );
        return scoreLead({ ...cached, input }, config);
      }
    }
    const metrics = await analyzeChannel(
      input,
      channel,
      config,
      client,
      now().getTime(),
    );
    await cache.set(
      channel.id,
      normalized,
      metrics,
      config.cacheTtlDays * DAY_MS,
    );
    return scoreLead(metrics, config);
  };

  const worker = async (): Promise<void> => {
    while (cursor < inputItems.length && !stopped) {
      const index = cursor;
      cursor += 1;
      const input = inputItems[index]!;
      try {
        const result = await processOne(input);
        saveResult(result);
        log(
          `${result.status.padEnd(9)} ${String(result.score ?? "-").padStart(2)}  ${result.name ?? input}`,
        );
        await flush();
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          stopped = "budget";
          log(
            "Stopping: configured daily quota budget reached. Partial results are saved.",
          );
          break;
        }
        if (error instanceof QuotaExceededError) {
          stopped = "quota";
          log(
            "Stopping: YouTube API quota exceeded. Partial results are saved; try again tomorrow.",
          );
          break;
        }
        const message = error instanceof Error ? error.message : String(error);
        const result: LeadResult = { input, status: "ERROR", why: message };
        saveResult(result);
        log(`ERROR     ${input}: ${message}`);
        await flush();
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency) }, () => worker()),
  );
  await flush();
  return { results, stopped, searchCount };
}

async function analyzeChannel(
  input: string,
  channel: Channel,
  config: Config,
  client: YouTubeClient,
  now: number,
): Promise<LeadMetrics> {
  const description = channel.snippet.description ?? "";
  const baseMetrics = {
    input,
    name: channel.snippet.title ?? "",
    handle: channel.snippet.customUrl ?? "",
    subs: Number(channel.statistics?.subscriberCount ?? 0),
    uploads30: 0,
    avgComments: 0,
    totalComments5: 0,
    commentEnabledVideos: 0,
    creatorReplies: 0,
    description,
    url: `https://www.youtube.com/channel/${channel.id}`,
  };

  const playlistId = channel.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) return baseMetrics;
  const uploads = await client.playlistUploads(
    playlistId,
    config.uploadLookbackCount,
  );
  const videoIds = (uploads.items ?? [])
    .map((item) => item.contentDetails?.videoId)
    .filter((id): id is string => Boolean(id));
  if (videoIds.length === 0) return baseMetrics;

  const videos = await client.videos(videoIds);
  const datedVideos = (videos.items ?? [])
    .map((video) => ({
      video,
      publishedAt: new Date(video.snippet.publishedAt).getTime(),
      commentCount:
        video.statistics?.commentCount === undefined
          ? undefined
          : Number(video.statistics.commentCount),
    }))
    .filter((item) => Number.isFinite(item.publishedAt))
    .sort((a, b) => b.publishedAt - a.publishedAt);
  const recent = datedVideos.slice(0, config.thresholds.recentVideoCount);
  const enabled = recent.filter((video) => video.commentCount !== undefined);
  const commentsTotal = enabled.reduce(
    (sum, video) => sum + (video.commentCount ?? 0),
    0,
  );
  const uploads30 = datedVideos.filter((video) => {
    const age = now - video.publishedAt;
    return age >= 0 && age <= config.thresholds.uploadsWindowDays * DAY_MS;
  }).length;
  const latest = datedVideos[0]?.publishedAt;
  const metrics = {
    ...baseMetrics,
    uploads30,
    avgComments:
      enabled.length > 0 ? Math.round(commentsTotal / enabled.length) : 0,
    totalComments5: commentsTotal,
    commentEnabledVideos: enabled.length,
    ...(latest === undefined
      ? {}
      : { daysSinceUpload: Math.max(0, Math.round((now - latest) / DAY_MS)) }),
  };

  const mostCommented = [...recent]
    .filter((video) => (video.commentCount ?? 0) > 0)
    .sort((a, b) => (b.commentCount ?? 0) - (a.commentCount ?? 0))[0];
  if (mostCommented) {
    try {
      const threads = await client.commentThreads(
        mostCommented.video.id,
        config.maxCommentThreads,
      );
      metrics.creatorReplies = creatorReplyTally(
        threads.items ?? [],
        channel.id,
      );
    } catch (error) {
      if (
        error instanceof YouTubeApiError &&
        ["commentsDisabled", "commentsNotAllowed"].includes(error.reason ?? "")
      ) {
        metrics.commentEnabledVideos = Math.max(
          0,
          metrics.commentEnabledVideos - 1,
        );
        metrics.totalComments5 = Math.max(
          0,
          metrics.totalComments5 - (mostCommented.commentCount ?? 0),
        );
        metrics.avgComments =
          metrics.commentEnabledVideos > 0
            ? Math.round(metrics.totalComments5 / metrics.commentEnabledVideos)
            : 0;
      } else if (
        !(error instanceof YouTubeApiError) ||
        error.reason !== "videoNotFound"
      ) {
        throw error;
      }
    }
  }

  return metrics;
}

function creatorReplyTally(
  threads: CommentThread[],
  channelId: string,
): number {
  return threads.filter((thread) =>
    (thread.replies?.comments ?? []).some(
      (reply) => reply.snippet?.authorChannelId?.value === channelId,
    ),
  ).length;
}
