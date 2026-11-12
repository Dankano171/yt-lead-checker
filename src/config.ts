import { readFile } from "node:fs/promises";
import type { Config, Tier } from "./types.js";

export const DEFAULT_CONFIG: Config = {
  dailyBudget: 9000,
  cacheTtlDays: 30,
  uploadLookbackCount: 20,
  thresholds: {
    subscriberMin: 10000,
    subscriberMax: 500000,
    recentVideoCount: 5,
    minimumCommentEnabledRecentVideos: 1,
    minimumTotalComments: 100,
    uploadsWindowDays: 30,
    minimumUploads: 2,
    commentAverageTiers: [
      { minimum: 200, points: 3 },
      { minimum: 100, points: 2 },
      { minimum: 50, points: 1 },
    ],
    creatorReplyTiers: [
      { minimum: 3, points: 2 },
      { minimum: 1, points: 1 },
    ],
  },
  scores: {
    subscribersInRange: 1,
    uploadsQualified: 2,
    monetizationSignals: 2,
  },
  monetizationSignals: [
    "patreon",
    "skool",
    "whop",
    "gumroad",
    "kajabi",
    "teachable",
    "discord",
    "telegram",
    "course",
    "membership",
    "coaching",
    "sponsor",
    "shop",
  ],
  maxCommentThreads: 50,
  maxDescriptionLinks: 10,
  retries: 3,
  retryBaseDelayMs: 500,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveNumber(
  value: unknown,
  name: string,
  allowZero = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (allowZero ? value < 0 : value <= 0)
  ) {
    throw new Error(
      `Invalid config: ${name} must be ${allowZero ? "non-negative" : "positive"}.`,
    );
  }
  return value;
}

function tiers(value: unknown, name: string): Tier[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid config: ${name} must be an array.`);
  }
  const parsed = value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Invalid config: ${name}[${index}] must be an object.`);
    }
    return {
      minimum: positiveNumber(item.minimum, `${name}[${index}].minimum`, true),
      points: positiveNumber(item.points, `${name}[${index}].points`, true),
    };
  });
  return parsed.sort((a, b) => b.minimum - a.minimum);
}

export function mergeConfig(input: unknown): Config {
  if (!isRecord(input)) {
    throw new Error("Invalid config: expected a JSON object.");
  }
  const thresholdInput = input.thresholds === undefined ? {} : input.thresholds;
  const scoreInput = input.scores === undefined ? {} : input.scores;
  if (!isRecord(thresholdInput) || !isRecord(scoreInput)) {
    throw new Error("Invalid config: thresholds and scores must be objects.");
  }

  const numberSetting = (
    source: Record<string, unknown>,
    key: string,
    fallback: number,
    allowZero = false,
  ): number =>
    source[key] === undefined
      ? fallback
      : positiveNumber(source[key], key, allowZero);

  const tierSetting = (
    key: "commentAverageTiers" | "creatorReplyTiers",
    fallback: Tier[],
  ): Tier[] =>
    thresholdInput[key] === undefined
      ? fallback
      : tiers(thresholdInput[key], key);

  const signals =
    input.monetizationSignals === undefined
      ? DEFAULT_CONFIG.monetizationSignals
      : input.monetizationSignals;
  if (
    !Array.isArray(signals) ||
    signals.some((signal) => typeof signal !== "string")
  ) {
    throw new Error(
      "Invalid config: monetizationSignals must be an array of strings.",
    );
  }

  const config: Config = {
    dailyBudget: numberSetting(
      input,
      "dailyBudget",
      DEFAULT_CONFIG.dailyBudget,
    ),
    cacheTtlDays: numberSetting(
      input,
      "cacheTtlDays",
      DEFAULT_CONFIG.cacheTtlDays,
    ),
    uploadLookbackCount: numberSetting(
      input,
      "uploadLookbackCount",
      DEFAULT_CONFIG.uploadLookbackCount,
    ),
    thresholds: {
      subscriberMin: numberSetting(
        thresholdInput,
        "subscriberMin",
        DEFAULT_CONFIG.thresholds.subscriberMin,
        true,
      ),
      subscriberMax: numberSetting(
        thresholdInput,
        "subscriberMax",
        DEFAULT_CONFIG.thresholds.subscriberMax,
        true,
      ),
      recentVideoCount: numberSetting(
        thresholdInput,
        "recentVideoCount",
        DEFAULT_CONFIG.thresholds.recentVideoCount,
      ),
      minimumCommentEnabledRecentVideos: numberSetting(
        thresholdInput,
        "minimumCommentEnabledRecentVideos",
        DEFAULT_CONFIG.thresholds.minimumCommentEnabledRecentVideos,
        true,
      ),
      minimumTotalComments: numberSetting(
        thresholdInput,
        "minimumTotalComments",
        DEFAULT_CONFIG.thresholds.minimumTotalComments,
        true,
      ),
      uploadsWindowDays: numberSetting(
        thresholdInput,
        "uploadsWindowDays",
        DEFAULT_CONFIG.thresholds.uploadsWindowDays,
      ),
      minimumUploads: numberSetting(
        thresholdInput,
        "minimumUploads",
        DEFAULT_CONFIG.thresholds.minimumUploads,
        true,
      ),
      commentAverageTiers: tierSetting(
        "commentAverageTiers",
        DEFAULT_CONFIG.thresholds.commentAverageTiers,
      ),
      creatorReplyTiers: tierSetting(
        "creatorReplyTiers",
        DEFAULT_CONFIG.thresholds.creatorReplyTiers,
      ),
    },
    scores: {
      subscribersInRange: numberSetting(
        scoreInput,
        "subscribersInRange",
        DEFAULT_CONFIG.scores.subscribersInRange,
        true,
      ),
      uploadsQualified: numberSetting(
        scoreInput,
        "uploadsQualified",
        DEFAULT_CONFIG.scores.uploadsQualified,
        true,
      ),
      monetizationSignals: numberSetting(
        scoreInput,
        "monetizationSignals",
        DEFAULT_CONFIG.scores.monetizationSignals,
        true,
      ),
    },
    monetizationSignals: signals.map((signal) => signal.toLowerCase()),
    maxCommentThreads: numberSetting(
      input,
      "maxCommentThreads",
      DEFAULT_CONFIG.maxCommentThreads,
    ),
    maxDescriptionLinks: numberSetting(
      input,
      "maxDescriptionLinks",
      DEFAULT_CONFIG.maxDescriptionLinks,
      true,
    ),
    retries: numberSetting(input, "retries", DEFAULT_CONFIG.retries, true),
    retryBaseDelayMs: numberSetting(
      input,
      "retryBaseDelayMs",
      DEFAULT_CONFIG.retryBaseDelayMs,
      true,
    ),
  };
  if (config.cacheTtlDays > 30) {
    throw new Error("Invalid config: cacheTtlDays cannot exceed 30 days.");
  }
  if (config.uploadLookbackCount > 50 || config.maxCommentThreads > 50) {
    throw new Error(
      "Invalid config: uploadLookbackCount and maxCommentThreads cannot exceed 50.",
    );
  }
  if (config.thresholds.recentVideoCount > config.uploadLookbackCount) {
    throw new Error(
      "Invalid config: recentVideoCount cannot exceed uploadLookbackCount.",
    );
  }
  if (config.thresholds.subscriberMin > config.thresholds.subscriberMax) {
    throw new Error(
      "Invalid config: subscriberMin cannot exceed subscriberMax.",
    );
  }
  if (
    config.thresholds.minimumCommentEnabledRecentVideos >
    config.thresholds.recentVideoCount
  ) {
    throw new Error(
      "Invalid config: minimumCommentEnabledRecentVideos cannot exceed recentVideoCount.",
    );
  }
  return config;
}

export async function loadConfig(path?: string): Promise<Config> {
  if (!path) return DEFAULT_CONFIG;
  try {
    return mergeConfig(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Could not parse config file "${path}": ${error.message}`,
      );
    }
    throw error;
  }
}
