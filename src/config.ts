import { readFile } from "node:fs/promises";
import type { Config, Tier } from "./types.js";

export const DEFAULT_CONFIG: Config = {
  dailyBudget: 9000,
  cacheTtlDays: 30,
  uploadLookbackCount: 20,
  thresholds: {
    subscriberMin: 10000,
    subscriberMax: 500000,
    recentVideoCount: 20,
    minimumCommentEnabledRecentVideos: 1,
    minimumTotalComments: 100,
    uploadsWindowDays: 30,
    minimumUploads: 2,
    commentTotalTiers: [
      { minimum: 200, points: 3 },
      { minimum: 100, points: 2 },
      { minimum: 50, points: 1 },
    ],
    unansweredQuestionTiers: [
      { minimum: 10, points: 3 },
      { minimum: 5, points: 2 },
      { minimum: 2, points: 1 },
    ],
    creatorReplyRateMin: 5,
    creatorReplyRateMax: 70,
    creatorReplyRateNoteThreshold: 90,
  },
  scores: {
    subscribersInRange: 1,
    uploadsQualified: 2,
    monetizationSignals: 2,
    creatorReplyRate: 1,
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
  maxCommentThreads: 100,
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

  const tierSetting = (key: string, fallback: Tier[]): Tier[] => {
    const legacyValue =
      key === "commentTotalTiers"
        ? thresholdInput.commentAverageTiers
        : undefined;
    const value = thresholdInput[key] ?? legacyValue;
    return value === undefined ? fallback : tiers(value, key);
  };

  const percentageSetting = (key: string, fallback: number): number => {
    const value = numberSetting(thresholdInput, key, fallback, true);
    if (value > 100) {
      throw new Error(`Invalid config: ${key} cannot exceed 100.`);
    }
    return value;
  };

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
      commentTotalTiers: tierSetting(
        "commentTotalTiers",
        DEFAULT_CONFIG.thresholds.commentTotalTiers,
      ),
      unansweredQuestionTiers: tierSetting(
        "unansweredQuestionTiers",
        DEFAULT_CONFIG.thresholds.unansweredQuestionTiers,
      ),
      creatorReplyRateMin: percentageSetting(
        "creatorReplyRateMin",
        DEFAULT_CONFIG.thresholds.creatorReplyRateMin,
      ),
      creatorReplyRateMax: percentageSetting(
        "creatorReplyRateMax",
        DEFAULT_CONFIG.thresholds.creatorReplyRateMax,
      ),
      creatorReplyRateNoteThreshold: percentageSetting(
        "creatorReplyRateNoteThreshold",
        DEFAULT_CONFIG.thresholds.creatorReplyRateNoteThreshold,
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
      creatorReplyRate: numberSetting(
        scoreInput,
        "creatorReplyRate",
        DEFAULT_CONFIG.scores.creatorReplyRate,
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
  if (!Number.isInteger(config.maxCommentThreads)) {
    throw new Error(
      "Invalid config: maxCommentThreads must be a whole number.",
    );
  }
  if (config.cacheTtlDays > 30) {
    throw new Error("Invalid config: cacheTtlDays cannot exceed 30 days.");
  }
  if (config.uploadLookbackCount > 20 || config.maxCommentThreads > 100) {
    throw new Error(
      "Invalid config: uploadLookbackCount cannot exceed 20 and maxCommentThreads cannot exceed 100.",
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
    config.thresholds.creatorReplyRateMin >
    config.thresholds.creatorReplyRateMax
  ) {
    throw new Error(
      "Invalid config: creatorReplyRateMin cannot exceed creatorReplyRateMax.",
    );
  }
  if (
    config.thresholds.minimumCommentEnabledRecentVideos >
    config.uploadLookbackCount
  ) {
    throw new Error(
      "Invalid config: minimumCommentEnabledRecentVideos cannot exceed uploadLookbackCount.",
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
