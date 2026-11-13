import { mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { LeadResult } from "./types.js";

export const RESULT_COLUMNS = [
  "status",
  "score",
  "name",
  "handle",
  "subs",
  "uploads30",
  "daysSinceUpload",
  "avgComments",
  "totalComments",
  "creatorReplies",
  "moneySignals",
  "emailInDescription",
  "links",
  "url",
  "why",
  "input",
] as const;

function csvCell(value: unknown): string {
  const rawText = value === undefined || value === null ? "" : String(value);
  const text = /^[\s]*[=+\-@]/.test(rawText) ? `'${rawText}` : rawText;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function writeResultsCsv(
  path: string,
  results: LeadResult[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const content = [
    RESULT_COLUMNS.join(","),
    ...results.map((result) =>
      RESULT_COLUMNS.map((column) => csvCell(result[column])).join(","),
    ),
  ].join("\n");
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${content}\n`, "utf8");
  await rename(temporary, path);
}
