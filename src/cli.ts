#!/usr/bin/env node
import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { checkLeads } from "./checker.js";
import { LeadCache } from "./cache.js";
import { loadConfig } from "./config.js";
import { parseLeadFile } from "./inputs.js";
import { DailyQuota, readQuota } from "./quota.js";
import { YouTubeClient } from "./youtube.js";
import { readJson } from "./storage.js";
import type { LeadResult, RunFile } from "./types.js";

const program = new Command();

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("must be a non-negative whole number");
  }
  return parsed;
}

function positiveConcurrency(value: string): number {
  const parsed = positiveInteger(value);
  if (parsed === 0) throw new InvalidArgumentError("must be greater than zero");
  return parsed;
}

function requiredKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key)
    throw new Error(
      "Missing YOUTUBE_API_KEY. See the safe setup steps in README.md.",
    );
  return key;
}

function displayResult(result: LeadResult): string {
  return `${result.status.padEnd(9)} ${String(result.score ?? "-").padStart(2)}  ${result.name ?? result.input}`;
}

function categorizeFailure(reason: string): string {
  if (reason.startsWith("subscribers "))
    return "Subscribers outside configured range";
  if (reason.startsWith("comments disabled"))
    return "Comments disabled on recent videos";
  if (reason.includes("comments in ")) return "Below minimum recent comments";
  if (reason.includes("uploads in "))
    return "Below minimum uploads in the lookback window";
  return reason;
}

program
  .name("yt-lead-checker")
  .description("Qualify YouTube channels as potential creator-service leads.")
  .showHelpAfterError();

program
  .command("check")
  .argument("<file>", "text or CSV list of YouTube channels")
  .option("--search", "allow plain-name searches (100 quota units each)")
  .option(
    "--max-search <number>",
    "maximum plain-name searches",
    positiveInteger,
    20,
  )
  .option("--out <directory>", "output directory", "output")
  .option("--config <file>", "JSON configuration file")
  .option("--refresh", "ignore cached and previous completed results")
  .option(
    "--concurrency <number>",
    "simultaneous channel checks",
    positiveConcurrency,
    1,
  )
  .action(async (file: string, options: CheckOptionsCli) => {
    const config = await getConfig(options.config);
    const inputs = parseLeadFile(await readFile(file, "utf8"), file);
    const outputDirectory = options.out;
    await mkdir(outputDirectory, { recursive: true });
    const quota = await DailyQuota.open("usage-log.json", config.dailyBudget);
    const client = new YouTubeClient({
      apiKey: requiredKey(),
      budget: quota,
      retries: config.retries,
      retryBaseDelayMs: config.retryBaseDelayMs,
    });
    const result = await checkLeads({
      inputs,
      config,
      client,
      cache: await LeadCache.open("cache/cache.json"),
      outputPath: join(outputDirectory, "results.json"),
      csvPath: join(outputDirectory, "results.csv"),
      refresh: Boolean(options.refresh),
      allowSearch: Boolean(options.search),
      maxSearch: options.maxSearch,
      concurrency: options.concurrency,
      log: console.log,
    });
    const pass = result.results.filter((row) => row.status === "PASS").length;
    const fail = result.results.filter((row) => row.status === "FAIL").length;
    console.log(
      `\nDone. ${pass} PASS, ${fail} FAIL, ${result.results.length} saved. Estimated quota used today: ${quota.used}.`,
    );
    if (result.stopped)
      console.log(
        `Run stopped at ${result.stopped}; rerun this command to resume.`,
      );
    console.log(
      `Saved ${join(outputDirectory, "results.csv")} and ${join(outputDirectory, "results.json")}`,
    );
  });

program
  .command("report")
  .option("--out <directory>", "output directory", "output")
  .action(async (options: { out: string }) => {
    const run = await readJson<RunFile>(join(options.out, "results.json"), {
      runAt: "",
      results: [],
    });
    if (!run.results?.length) {
      console.log(
        "No saved run found. Run `yt-lead-checker check <file>` first.",
      );
      return;
    }
    const passed = run.results.filter((result) => result.status === "PASS");
    const failed = run.results.filter((result) => result.status === "FAIL");
    console.log(`Last run: ${run.runAt || "unknown"}`);
    console.log(`PASS: ${passed.length}  FAIL: ${failed.length}`);
    console.log("\nTop 20 by score:");
    for (const result of [...run.results]
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      .slice(0, 20)) {
      console.log(displayResult(result));
    }
    const reasons = new Map<string, number>();
    for (const result of failed) {
      for (const reason of (result.why ?? "unspecified").split("; ")) {
        const category = categorizeFailure(reason);
        reasons.set(category, (reasons.get(category) ?? 0) + 1);
      }
    }
    console.log("\nFailure reasons:");
    if (reasons.size === 0) console.log("None");
    for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
      console.log(`${count}  ${reason}`);
    }
  });

program.command("quota").action(async () => {
  const config = await getConfig();
  const used = await readQuota("usage-log.json");
  console.log(
    `Estimated YouTube API units used today (UTC): ${used} / ${config.dailyBudget}`,
  );
});

interface CheckOptionsCli {
  search?: boolean;
  maxSearch: number;
  out: string;
  config?: string;
  refresh?: boolean;
  concurrency: number;
}

async function getConfig(path?: string) {
  if (path) return loadConfig(path);
  try {
    await access("config.json");
    return loadConfig("config.json");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return loadConfig();
    throw error;
  }
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
