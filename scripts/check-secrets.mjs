import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean);
const keyPattern = /AIza[0-9A-Za-z_-]{30,}/;
const findings = [];

for (const file of files) {
  try {
    const contents = await readFile(file, "utf8");
    if (keyPattern.test(contents)) findings.push(file);
  } catch (error) {
    if (error.code !== "EISDIR") throw error;
  }
}

if (findings.length > 0) {
  console.error(`Possible Google API key found in: ${findings.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("No Google API key patterns found.");
}
