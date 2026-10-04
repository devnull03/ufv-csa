import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bufferSource, GcodeParseError, parseDuration, parseGcodeFile, printerModelMatches } from "..";
import { parseGcode } from "../parse";
import { asciiGcode, binaryGcode, PNG_1PX } from "./fixtures";

describe("ASCII .gcode", () => {
  it("reads print stats, printer model, bounding box and the PNG thumbnail", async () => {
    const parsed = await parseGcode(bufferSource(Buffer.from(asciiGcode())));
    expect(parsed.summary).toEqual({
      format: "gcode",
      printSeconds: 1 * 3600 + 23 * 60 + 45,
      filamentGrams: 12.88,
      filamentType: "PETG",
      printerModel: "MK4S",
      bbox: { x: 67, y: 43.6, z: 18.2 },
      hasThumbnail: true,
    });
    expect(parsed.thumbnail?.format).toBe("png");
    expect(Buffer.from(parsed.thumbnail!.data).equals(PNG_1PX)).toBe(true);
  });

  it("parses from disk with ranged reads", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "printq-"));
    try {
      const file = path.join(dir, "part.gcode");
      await writeFile(file, asciiGcode());
      expect((await parseGcodeFile(file)).summary.printerModel).toBe("MK4S");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects files that are not G-code", async () => {
    await expect(parseGcode(bufferSource(Buffer.from("<html>nope</html>")))).rejects.toThrow(GcodeParseError);
  });
});

describe("binary .bgcode", () => {
  it("reads metadata blocks and the thumbnail, stopping before G-code blocks", async () => {
    const parsed = await parseGcode(bufferSource(binaryGcode()));
    expect(parsed.summary).toEqual({
      format: "bgcode",
      printSeconds: 2 * 86400 + 3600 + 5,
      filamentGrams: 3.21,
      filamentType: "PLA",
      printerModel: "MK4S",
      bbox: null,
      hasThumbnail: true,
    });
    expect(parsed.metadata.Producer).toBe("PrusaSlicer 2.9.2");
    expect(Buffer.from(parsed.thumbnail!.data).equals(PNG_1PX)).toBe(true);
  });

  it("rejects unknown versions", async () => {
    const file = binaryGcode();
    file.writeUInt32LE(2, 4);
    await expect(parseGcode(bufferSource(file))).rejects.toThrow("Unsupported bgcode version 2");
  });
});

describe("helpers", () => {
  it("parses slicer durations", () => {
    expect(parseDuration("45m 3s")).toBe(2703);
    expect(parseDuration("1d 0h 0m 0s")).toBe(86400);
    expect(parseDuration("")).toBeNull();
  });

  it("matches printer models strictly but allows MMU variants", () => {
    expect(printerModelMatches("MK4S", "MK4S")).toBe(true);
    expect(printerModelMatches("MK4SMMU3", "MK4S")).toBe(true);
    expect(printerModelMatches("MK4", "MK4S")).toBe(false);
    expect(printerModelMatches("MK4S", "MK4")).toBe(false);
    expect(printerModelMatches(null, "MK4S")).toBe(false);
  });
});
