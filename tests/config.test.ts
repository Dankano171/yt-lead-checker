import { describe, expect, it } from "vitest";
import { mergeConfig } from "../src/config.js";

describe("mergeConfig scoring settings", () => {
  it("loads the configurable reply-rate and question thresholds", () => {
    const config = mergeConfig({
      maxCommentThreads: 100,
      thresholds: {
        commentTotalTiers: [{ minimum: 250, points: 3 }],
        unansweredQuestionTiers: [{ minimum: 8, points: 3 }],
        creatorReplyRateMin: 8,
        creatorReplyRateMax: 65,
        creatorReplyRateNoteThreshold: 92,
      },
    });

    expect(config.thresholds.commentTotalTiers).toEqual([
      { minimum: 250, points: 3 },
    ]);
    expect(config.thresholds.unansweredQuestionTiers).toEqual([
      { minimum: 8, points: 3 },
    ]);
    expect(config.thresholds.creatorReplyRateMin).toBe(8);
    expect(config.thresholds.creatorReplyRateMax).toBe(65);
    expect(config.thresholds.creatorReplyRateNoteThreshold).toBe(92);
  });

  it("accepts the previous comment-tier key and rejects invalid sample rates", () => {
    const config = mergeConfig({
      thresholds: {
        commentAverageTiers: [{ minimum: 150, points: 2 }],
      },
    });

    expect(config.thresholds.commentTotalTiers).toEqual([
      { minimum: 150, points: 2 },
    ]);
    expect(() => mergeConfig({ maxCommentThreads: 101 })).toThrow(
      "maxCommentThreads cannot exceed 100",
    );
    expect(() =>
      mergeConfig({ thresholds: { creatorReplyRateMin: 101 } }),
    ).toThrow("creatorReplyRateMin cannot exceed 100");
    expect(() => mergeConfig({ maxCommentThreads: 1.5 })).toThrow(
      "maxCommentThreads must be a whole number",
    );
    expect(() =>
      mergeConfig({
        thresholds: { creatorReplyRateMin: 75, creatorReplyRateMax: 70 },
      }),
    ).toThrow("creatorReplyRateMin cannot exceed creatorReplyRateMax");
  });
});
