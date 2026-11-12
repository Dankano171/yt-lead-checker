import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { scoreLead } from "../src/scoring.js";

const qualifyingMetrics = {
  input: "@goodchannel",
  name: "Good Channel",
  handle: "@goodchannel",
  subs: 10000,
  uploads30: 2,
  daysSinceUpload: 1,
  avgComments: 200,
  totalComments5: 100,
  commentEnabledVideos: 1,
  creatorReplies: 3,
  description:
    "Join my Patreon course at https://example.com and email me@test.example",
  url: "https://www.youtube.com/channel/UC",
};

describe("scoreLead", () => {
  it("awards the configured maximum score and captures description details", () => {
    const result = scoreLead(qualifyingMetrics, DEFAULT_CONFIG);

    expect(result.status).toBe("PASS");
    expect(result.score).toBe(10);
    expect(result.moneySignals).toBe("patreon course");
    expect(result.links).toBe("https://example.com");
    expect(result.emailInDescription).toBe("me@test.example");
  });

  it("explains every failed hard requirement", () => {
    const result = scoreLead(
      {
        ...qualifyingMetrics,
        subs: 9999,
        uploads30: 1,
        avgComments: 0,
        totalComments5: 10,
        commentEnabledVideos: 0,
      },
      DEFAULT_CONFIG,
    );

    expect(result.status).toBe("FAIL");
    expect(result.why).toContain("subscribers 9999");
    expect(result.why).toContain("comments disabled");
    expect(result.why).toContain("10 comments");
    expect(result.why).toContain("1 uploads in 30 days");
  });
});
