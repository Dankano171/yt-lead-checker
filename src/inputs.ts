export type LeadReference =
  | { kind: "id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "name"; value: string };

const CHANNEL_ID = /^UC[\w-]{22}$/;
const HANDLE = /^@[\w.-]+$/;

export function parseLeadReference(input: string): LeadReference {
  const value = input.trim();
  if (CHANNEL_ID.test(value)) return { kind: "id", value };
  if (HANDLE.test(value)) return { kind: "handle", value };

  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    // Non-URL values are names unless they match a supported identifier.
  }
  if (url && /(^|\.)youtube\.com$/i.test(url.hostname)) {
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      segments[0] === "channel" &&
      segments[1] &&
      CHANNEL_ID.test(segments[1])
    ) {
      return { kind: "id", value: segments[1] };
    }
    const handleSegment = segments.find((segment) => segment.startsWith("@"));
    if (handleSegment && HANDLE.test(handleSegment)) {
      return { kind: "handle", value: handleSegment };
    }
  }

  const embeddedId = value.match(/(?:^|\/)(UC[\w-]{22})(?:$|[/?#])/);
  if (embeddedId?.[1]) return { kind: "id", value: embeddedId[1] };
  return { kind: "name", value };
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("Invalid CSV: a quoted field is not closed.");
  cells.push(cell.trim());
  return cells;
}

export function parseLeadFile(contents: string, fileName: string): string[] {
  if (fileName.toLowerCase().endsWith(".csv")) {
    const lines = contents.split(/\r?\n/).filter((line) => line.trim() !== "");
    if (lines.length === 0) return [];
    const headers = parseCsvRow(lines[0]!.replace(/^\uFEFF/, "")).map(
      (header) => header.toLowerCase(),
    );
    const column = headers.findIndex(
      (header) => header === "channel" || header === "handle",
    );
    if (column < 0)
      throw new Error('CSV input must have a "channel" or "handle" column.');
    return lines
      .slice(1)
      .map((line) => parseCsvRow(line)[column] ?? "")
      .filter(Boolean);
  }
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function normalizeInput(input: string): string {
  const reference = parseLeadReference(input);
  if (reference.kind === "id") return `id:${reference.value}`;
  if (reference.kind === "handle")
    return `handle:${reference.value.toLowerCase()}`;
  return `name:${reference.value.toLowerCase()}`;
}
