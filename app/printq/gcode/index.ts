import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import type { ParsedGcodeSummary } from "../db/schema";
import { GcodeAnalyzer, type GcodeAnalysis } from "./analyze";
import { parseGcode, type ByteSource, type ParsedGcode } from "./parse";

export { GcodeParseError, parseDuration } from "./parse";
export { fitsBuildVolume, printerAcceptsBgcode, printerModelMatches } from "./model";
export type { ParsedGcode, Thumbnail } from "./parse";

export function bufferSource(buffer: Uint8Array): ByteSource {
  return {
    size: buffer.byteLength,
    async read(offset, length) {
      return buffer.subarray(offset, Math.min(buffer.byteLength, offset + length));
    },
  };
}

/** Reads the slicer's metadata, then (for plain .gcode) works the numbers out from the moves too. */
export async function parseGcodeFile(path: string): Promise<ParsedGcode> {
  const parsed = await readMetadata(path);
  if (parsed.summary.format !== "gcode") return parsed;
  const number = (key: string) => {
    const value = Number.parseFloat(parsed.metadata[key]?.split(/[,;]/)[0] ?? "");
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const analysis = await analyzeGcodeFile(path, {
    filamentDiameterMm: number("filament_diameter"),
    densityGcm3: number("filament_density"),
    filamentType: parsed.summary.filamentType,
  });
  return { ...parsed, summary: mergeAnalysis(parsed.summary, analysis) };
}

export async function analyzeGcodeFile(path: string, options: Parameters<GcodeAnalyzer["finish"]>[0] = {}): Promise<GcodeAnalysis> {
  const analyzer = new GcodeAnalyzer();
  let carry = "";
  for await (const chunk of createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 20 })) {
    const lines = (carry + chunk).split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) analyzer.push(line);
  }
  analyzer.push(carry);
  return analyzer.finish(options);
}

/** Slicer numbers win when present; ours fill the gaps and are kept for comparison. */
export function mergeAnalysis(summary: ParsedGcodeSummary, analysis: GcodeAnalysis): ParsedGcodeSummary {
  const slicerSeconds = summary.printSeconds ?? analysis.m73Seconds;
  const footprint = analysis.footprint;
  return {
    ...summary,
    printSeconds: slicerSeconds ?? (analysis.estimatedSeconds > 0 ? analysis.estimatedSeconds : null),
    filamentGrams: summary.filamentGrams ?? (analysis.filamentGrams > 0 ? analysis.filamentGrams : null),
    layerHeightMm: summary.layerHeightMm ?? analysis.layerHeightMm,
    bbox:
      summary.bbox ??
      (footprint && analysis.size
        ? { x: Math.round((footprint.maxX - footprint.minX) * 10) / 10, y: Math.round((footprint.maxY - footprint.minY) * 10) / 10, z: analysis.size.z }
        : null),
    analysis: {
      computedSeconds: analysis.estimatedSeconds,
      slicerSeconds,
      timeSource: summary.printSeconds ? "slicer" : analysis.m73Seconds ? "m73" : "computed",
      filamentMm: analysis.filamentMm,
      filamentGrams: analysis.filamentGrams,
      modelSize: analysis.size,
      layers: analysis.layers,
      maxHotendC: analysis.maxHotendC,
      maxBedC: analysis.maxBedC,
      filamentChanges: analysis.filamentChanges,
      pauses: analysis.pauses,
      tools: analysis.tools,
    },
  };
}

async function readMetadata(path: string): Promise<ParsedGcode> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    return await parseGcode({
      size,
      async read(offset, length) {
        const buffer = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
        await handle.read(buffer, 0, buffer.byteLength, offset);
        return buffer;
      },
    });
  } finally {
    await handle.close();
  }
}
