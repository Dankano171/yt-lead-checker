import { describe, expect, it } from "vitest";
import {
  normalizeInput,
  parseLeadFile,
  parseLeadReference,
} from "../src/inputs.js";

const channelId = `UC${"a".repeat(22)}`;

describe("lead parsing", () => {
  it("recognizes channel handles, URLs, and IDs", () => {
    expect(parseLeadReference("@creator")).toEqual({
      kind: "handle",
      value: "@creator",
    });
    expect(
      parseLeadReference("https://www.youtube.com/@creator/videos"),
    ).toEqual({
      kind: "handle",
      value: "@creator",
    });
    expect(
      parseLeadReference(`https://youtube.com/channel/${channelId}`),
    ).toEqual({
      kind: "id",
      value: channelId,
    });
    expect(parseLeadReference(channelId)).toEqual({
      kind: "id",
      value: channelId,
    });
    expect(parseLeadReference("Creator Name")).toEqual({
      kind: "name",
      value: "Creator Name",
    });
    expect(normalizeInput(channelId)).not.toBe(
      normalizeInput(`UC${"A".repeat(22)}`),
    );
  });

  it("ignores text comments and reads the CSV channel/handle column", () => {
    expect(
      parseLeadFile(
        "# ignored\n@one\n\nhttps://youtube.com/@two\n",
        "leads.txt",
      ),
    ).toEqual(["@one", "https://youtube.com/@two"]);
    expect(
      parseLeadFile(
        'name,channel\n"Creator, one",@one\nOther,@two\n',
        "leads.csv",
      ),
    ).toEqual(["@one", "@two"]);
  });
});
