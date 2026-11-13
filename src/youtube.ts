import type { Channel, QuotaBudget, UploadedVideo } from "./types.js";

const API_BASE = "https://www.googleapis.com/youtube/v3";

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | undefined,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

export class QuotaExceededError extends Error {
  constructor(message = "YouTube API quota exceeded for today.") {
    super(message);
    this.name = "QuotaExceededError";
  }
}

interface ApiErrorBody {
  error?: {
    message?: string;
    errors?: Array<{ reason?: string }>;
  };
}

export interface ApiList<T> {
  items?: T[];
}

export interface SearchResult {
  id?: { channelId?: string };
  snippet?: { channelId?: string };
}

export interface CommentThread {
  replies?: {
    comments?: Array<{
      snippet?: {
        authorChannelId?: { value?: string };
      };
    }>;
  };
}

export class YouTubeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly options: {
      apiKey: string;
      budget: QuotaBudget;
      retries: number;
      retryBaseDelayMs: number;
      fetchImpl?: typeof fetch;
      sleep?: (milliseconds: number) => Promise<void>;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  channelsById(id: string): Promise<ApiList<Channel>> {
    return this.request(
      "channels",
      { part: "snippet,statistics,contentDetails", id },
      1,
    );
  }

  channelsByHandle(handle: string): Promise<ApiList<Channel>> {
    return this.request(
      "channels",
      { part: "snippet,statistics,contentDetails", forHandle: handle },
      1,
    );
  }

  searchChannel(name: string): Promise<ApiList<SearchResult>> {
    return this.request(
      "search",
      { part: "snippet", type: "channel", q: name, maxResults: "1" },
      100,
    );
  }

  playlistUploads(
    playlistId: string,
    maxResults: number,
  ): Promise<ApiList<{ contentDetails?: { videoId?: string } }>> {
    return this.request(
      "playlistItems",
      { part: "contentDetails", playlistId, maxResults: String(maxResults) },
      1,
    );
  }

  videos(ids: string[]): Promise<ApiList<UploadedVideo>> {
    return this.request(
      "videos",
      { part: "snippet,statistics,contentDetails", id: ids.join(",") },
      1,
    );
  }

  commentThreads(
    videoId: string,
    maxResults: number,
  ): Promise<ApiList<CommentThread>> {
    return this.request(
      "commentThreads",
      {
        part: "snippet,replies",
        videoId,
        maxResults: String(maxResults),
        order: "relevance",
        textFormat: "plainText",
      },
      1,
    );
  }

  private async request<T>(
    resource: string,
    params: Record<string, string>,
    units: number,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      await this.options.budget.consume(units);
      const url = new URL(`${API_BASE}/${resource}`);
      for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value);
      url.searchParams.set("key", this.options.apiKey);

      let response: Response;
      try {
        response = await this.fetchImpl(url);
      } catch (error) {
        if (attempt >= this.options.retries) {
          throw new Error(redactKey(errorMessage(error), this.options.apiKey));
        }
        await this.sleep(this.options.retryBaseDelayMs * 2 ** attempt);
        continue;
      }

      if (response.ok) return (await response.json()) as T;

      let body: ApiErrorBody = {};
      try {
        body = (await response.json()) as ApiErrorBody;
      } catch {
        // Keep the HTTP status when the server does not send JSON.
      }
      const reason = body.error?.errors?.[0]?.reason;
      const message = redactKey(
        body.error?.message ?? `HTTP ${response.status}`,
        this.options.apiKey,
      );
      if (
        response.status === 403 &&
        (reason === "quotaExceeded" ||
          reason === "dailyLimitExceeded" ||
          /quota/i.test(message))
      ) {
        throw new QuotaExceededError(message);
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt < this.options.retries) {
          await this.sleep(this.options.retryBaseDelayMs * 2 ** attempt);
          continue;
        }
      }
      throw new YouTubeApiError(message, response.status, reason);
    }
  }
}

export function redactKey(message: string, apiKey: string): string {
  return apiKey.length > 0 ? message.split(apiKey).join("[REDACTED]") : message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
