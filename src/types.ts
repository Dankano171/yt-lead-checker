export interface Tier {
  minimum: number;
  points: number;
}

export interface Config {
  dailyBudget: number;
  cacheTtlDays: number;
  uploadLookbackCount: number;
  thresholds: {
    subscriberMin: number;
    subscriberMax: number;
    recentVideoCount: number;
    minimumCommentEnabledRecentVideos: number;
    minimumTotalComments: number;
    uploadsWindowDays: number;
    minimumUploads: number;
    commentAverageTiers: Tier[];
    creatorReplyTiers: Tier[];
  };
  scores: {
    subscribersInRange: number;
    uploadsQualified: number;
    monetizationSignals: number;
  };
  monetizationSignals: string[];
  maxCommentThreads: number;
  maxDescriptionLinks: number;
  retries: number;
  retryBaseDelayMs: number;
}

export type LeadStatus = "PASS" | "FAIL" | "NOT_FOUND" | "ERROR";

export interface LeadResult {
  input: string;
  status: LeadStatus;
  score?: number;
  name?: string;
  handle?: string;
  subs?: number;
  uploads30?: number;
  daysSinceUpload?: number;
  avgComments?: number;
  totalComments5?: number;
  creatorReplies?: number;
  moneySignals?: string;
  emailInDescription?: string;
  links?: string;
  url?: string;
  why?: string;
}

export interface RunFile {
  runAt: string;
  results: LeadResult[];
}

export interface Channel {
  id: string;
  snippet: {
    title?: string;
    customUrl?: string;
    description?: string;
  };
  statistics?: {
    subscriberCount?: string;
  };
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
    };
  };
}

export interface UploadedVideo {
  id: string;
  snippet: { publishedAt: string };
  statistics?: { commentCount?: string };
}

export interface YouTubeClientOptions {
  apiKey: string;
  budget: QuotaBudget;
  retries: number;
  retryBaseDelayMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface QuotaBudget {
  consume(units: number): Promise<void>;
}
