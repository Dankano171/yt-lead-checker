import type { Config, LeadResult } from "./types.js";

export interface LeadMetrics {
  input: string;
  name: string;
  handle: string;
  subs: number;
  uploads30: number;
  daysSinceUpload?: number;
  avgComments: number;
  totalComments: number;
  commentEnabledVideos: number;
  creatorReplies: number;
  creatorReplyRate: number;
  questionThreads: number;
  unansweredQuestions: number;
  description: string;
  url: string;
}

export function scoreLead(metrics: LeadMetrics, config: Config): LeadResult {
  const { thresholds, scores } = config;
  const subscribersInRange =
    metrics.subs >= thresholds.subscriberMin &&
    metrics.subs <= thresholds.subscriberMax;
  const uploadsQualified = metrics.uploads30 >= thresholds.minimumUploads;
  const commentsEnabled =
    metrics.commentEnabledVideos >=
    thresholds.minimumCommentEnabledRecentVideos;

  let score = subscribersInRange ? scores.subscribersInRange : 0;
  if (uploadsQualified) score += scores.uploadsQualified;
  for (const tier of thresholds.commentTotalTiers) {
    if (metrics.totalComments >= tier.minimum) {
      score += tier.points;
      break;
    }
  }
  for (const tier of thresholds.unansweredQuestionTiers) {
    if (metrics.unansweredQuestions >= tier.minimum) {
      score += tier.points;
      break;
    }
  }
  if (
    metrics.creatorReplyRate >= thresholds.creatorReplyRateMin &&
    metrics.creatorReplyRate <= thresholds.creatorReplyRateMax
  )
    score += scores.creatorReplyRate;

  const descriptionLower = metrics.description.toLowerCase();
  const moneySignals = config.monetizationSignals.filter((signal) =>
    descriptionLower.includes(signal),
  );
  if (moneySignals.length > 0) score += scores.monetizationSignals;
  const maximumRawScore =
    scores.subscribersInRange +
    scores.uploadsQualified +
    Math.max(0, ...thresholds.commentTotalTiers.map((tier) => tier.points)) +
    Math.max(
      0,
      ...thresholds.unansweredQuestionTiers.map((tier) => tier.points),
    ) +
    scores.creatorReplyRate +
    scores.monetizationSignals;
  const normalizedScore =
    maximumRawScore > 0 ? Math.round((score / maximumRawScore) * 10) : 0;

  const failures: string[] = [];
  if (!subscribersInRange) {
    failures.push(
      `subscribers ${metrics.subs} outside ${thresholds.subscriberMin}-${thresholds.subscriberMax}`,
    );
    if (
      metrics.subs > thresholds.subscriberMax &&
      metrics.subs <= thresholds.subscriberMax * 1.5
    )
      failures.push("near_cap");
  }
  if (!commentsEnabled) failures.push("comments disabled on recent videos");
  if (metrics.totalComments < thresholds.minimumTotalComments) {
    failures.push(
      `${metrics.totalComments} comments in ${thresholds.uploadsWindowDays} days (minimum ${thresholds.minimumTotalComments})`,
    );
  }
  if (!uploadsQualified) {
    failures.push(
      `${metrics.uploads30} uploads in ${thresholds.uploadsWindowDays} days (minimum ${thresholds.minimumUploads})`,
    );
  }

  const links = Array.from(metrics.description.matchAll(/https?:\/\/[^\s)]+/gi))
    .map((match) => match[0])
    .slice(0, config.maxDescriptionLinks);
  const email = [
    ...new Set(
      Array.from(
        metrics.description.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g),
        (match) => match[0],
      ),
    ),
  ].join(" ");
  const result: LeadResult = {
    input: metrics.input,
    status: failures.length === 0 ? "PASS" : "FAIL",
    score: Math.min(10, normalizedScore),
    name: metrics.name,
    handle: metrics.handle,
    subs: metrics.subs,
    uploads30: metrics.uploads30,
    avgComments: metrics.avgComments,
    totalComments: metrics.totalComments,
    creatorReplies: metrics.creatorReplies,
    creatorReplyRate: metrics.creatorReplyRate,
    questionThreads: metrics.questionThreads,
    unansweredQuestions: metrics.unansweredQuestions,
    moneySignals: moneySignals.join(" "),
    emailInDescription: email,
    links: links.join(" "),
    url: metrics.url,
  };
  if (metrics.daysSinceUpload !== undefined)
    result.daysSinceUpload = metrics.daysSinceUpload;
  if (failures.length > 0) result.why = failures.join("; ");
  else if (metrics.creatorReplyRate > thresholds.creatorReplyRateNoteThreshold)
    result.why = "creator already answers almost everything";
  return result;
}
