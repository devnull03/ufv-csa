import { inflateRawSync, inflateSync } from "node:zlib";
import type { ParsedGcodeSummary } from "../db/schema";

// Random-access reader so large files never have to be loaded whole.
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface Thumbnail {
  format: "png" | "jpg" | "qoi";
  width: number;
  height: number;
  data: Uint8Array;
}

export interface ParsedGcode {
  summary: ParsedGcodeSummary;
  metadata: Record<string, string>;
  thumbnail: Thumbnail | null;
}

export class GcodeParseError extends Error {}

const ASCII_HEAD_BYTES = 2 * 1024 * 1024;
const ASCII_TAIL_BYTES = 512 * 1024;
const BGCODE_MAGIC = "GCDE";

export async function parseGcode(source: ByteSource): Promise<ParsedGcode> {
  if (source.size < 4) throw new GcodeParseError("File is empty");
  const magic = new TextDecoder().decode(await source.read(0, 4));
  return magic === BGCODE_MAGIC ? parseBinary(source) : parseAscii(source);
}

// --- ASCII .gcode (PrusaSlicer): thumbnails in the head, stats and config in the tail ---

async function parseAscii(source: ByteSource): Promise<ParsedGcode> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const head = decoder.decode(await source.read(0, Math.min(source.size, ASCII_HEAD_BYTES)));
  if (!/^\s*(;|G\d|M\d|T\d)/m.test(head.slice(0, 4096))) {
    throw new GcodeParseError("This does not look like a G-code file");
  }
  const tailStart = Math.max(0, source.size - ASCII_TAIL_BYTES);
  const tail = tailStart === 0 ? head : decoder.decode(await source.read(tailStart, source.size - tailStart));

  const metadata: Record<string, string> = {};
  for (const text of [head, tail]) {
    for (const match of text.matchAll(/^;\s*([a-zA-Z_][^=\n]*?)\s*=\s*(.*?)\s*$/gm)) {
      metadata[match[1]] ??= match[2];
    }
  }

  const thumbnail = extractAsciiThumbnail(head);
  return { metadata, thumbnail, summary: summarize("gcode", metadata, head, thumbnail) };
}

function extractAsciiThumbnail(head: string): Thumbnail | null {
  const thumbnails: Thumbnail[] = [];
  const pattern = /^; thumbnail(?:_(PNG|JPG|QOI))? begin (\d+)x(\d+) \d+\n([\s\S]*?)^; thumbnail(?:_\w+)? end/gm;
  for (const match of head.matchAll(pattern)) {
    const base64 = match[4].replace(/^;\s?/gm, "").replace(/\s+/g, "");
    thumbnails.push({
      format: (match[1]?.toLowerCase() ?? "png") as Thumbnail["format"],
      width: Number(match[2]),
      height: Number(match[3]),
      data: Uint8Array.from(Buffer.from(base64, "base64")),
    });
  }
  return pickThumbnail(thumbnails);
}

// --- Binary .bgcode: metadata and thumbnails all precede the first G-code block ---

const BLOCK = { fileMetadata: 0, gcode: 1, slicerMetadata: 2, printerMetadata: 3, printMetadata: 4, thumbnail: 5 };
const THUMBNAIL_FORMATS: Thumbnail["format"][] = ["png", "jpg", "qoi"];

async function parseBinary(source: ByteSource): Promise<ParsedGcode> {
  const header = view(await source.read(0, 10));
  const version = header.getUint32(4, true);
  if (version !== 1) throw new GcodeParseError(`Unsupported bgcode version ${version}`);
  const checksumBytes = header.getUint16(8, true) === 1 ? 4 : 0;

  const metadata: Record<string, string> = {};
  const thumbnails: Thumbnail[] = [];
  let offset = 10;

  while (offset + 8 <= source.size) {
    const blockHeader = view(await source.read(offset, 12));
    const type = blockHeader.getUint16(0, true);
    if (type === BLOCK.gcode) break;
    const compression = blockHeader.getUint16(2, true);
    const uncompressedSize = blockHeader.getUint32(4, true);
    const headerSize = compression === 0 ? 8 : 12;
    const dataSize = compression === 0 ? uncompressedSize : blockHeader.getUint32(8, true);
    const paramsSize = type === BLOCK.thumbnail ? 6 : 2;
    const params = view(await source.read(offset + headerSize, paramsSize));
    const raw = await source.read(offset + headerSize + paramsSize, dataSize);
    offset += headerSize + paramsSize + dataSize + checksumBytes;

    if (type === BLOCK.thumbnail) {
      thumbnails.push({
        format: THUMBNAIL_FORMATS[params.getUint16(0, true)] ?? "png",
        width: params.getUint16(2, true),
        height: params.getUint16(4, true),
        data: decompress(raw, compression),
      });
    } else if (
      type === BLOCK.fileMetadata ||
      type === BLOCK.printerMetadata ||
      type === BLOCK.printMetadata ||
      type === BLOCK.slicerMetadata
    ) {
      const text = new TextDecoder().decode(decompress(raw, compression));
      for (const line of text.split("\n")) {
        const separator = line.indexOf("=");
        if (separator <= 0) continue;
        metadata[line.slice(0, separator).trim()] ??= line.slice(separator + 1).trim();
      }
    } else {
      throw new GcodeParseError(`Unknown bgcode block type ${type}`);
    }
  }

  const thumbnail = pickThumbnail(thumbnails);
  // Binary G-code blocks are compressed, so the M555 print-area hint is not read.
  return { metadata, thumbnail, summary: summarize("bgcode", metadata, "", thumbnail) };
}

function decompress(data: Uint8Array, compression: number): Uint8Array {
  if (compression === 0) return data;
  if (compression === 1) {
    try {
      return Uint8Array.from(inflateSync(data));
    } catch {
      return Uint8Array.from(inflateRawSync(data));
    }
  }
  // Heatshrink is only used for G-code blocks by PrusaSlicer, which we never read.
  throw new GcodeParseError(`Unsupported compression ${compression} in metadata`);
}

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// --- Shared ---

function pickThumbnail(thumbnails: Thumbnail[]): Thumbnail | null {
  const byArea = (a: Thumbnail, b: Thumbnail) => b.width * b.height - a.width * a.height;
  return thumbnails.filter((t) => t.format === "png").sort(byArea)[0] ?? thumbnails.sort(byArea)[0] ?? null;
}

function summarize(
  format: ParsedGcodeSummary["format"],
  metadata: Record<string, string>,
  head: string,
  thumbnail: Thumbnail | null
): ParsedGcodeSummary {
  const number = (key: string) => {
    const value = Number.parseFloat(metadata[key] ?? "");
    return Number.isFinite(value) ? value : null;
  };
  return {
    format,
    printSeconds: parseDuration(metadata["estimated printing time (normal mode)"]),
    filamentGrams: number("filament used [g]") ?? number("total filament used [g]"),
    filamentType: metadata["filament_type"]?.split(";")[0] ?? null,
    printerModel: metadata["printer_model"] || null,
    layerHeightMm: number("layer_height"),
    nozzleDiameterMm: firstNumber(metadata["nozzle_diameter"]),
    bbox: boundingBox(head, number("max_layer_z")),
    hasThumbnail: thumbnail !== null,
  };
}

// Multi-extruder values are comma-separated ("0.4,0.4"); use the first.
function firstNumber(value: string | undefined) {
  const parsed = Number.parseFloat(value?.split(",")[0] ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

// "1d 2h 3m 4s" -> seconds
export function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const units: Record<string, number> = { d: 86_400, h: 3_600, m: 60, s: 1 };
  let total = 0;
  let matched = false;
  for (const match of value.matchAll(/(\d+)\s*([dhms])/g)) {
    total += Number(match[1]) * units[match[2]];
    matched = true;
  }
  return matched ? total : null;
}

// PrusaSlicer's MK4/CORE One start G-code announces the print area with M555.
function boundingBox(head: string, maxLayerZ: number | null): ParsedGcodeSummary["bbox"] {
  const m555 = /^M555\s+X[-\d.]+\s+Y[-\d.]+\s+W([\d.]+)\s+H([\d.]+)/m.exec(head);
  if (!m555 || maxLayerZ === null) return null;
  return { x: Number(m555[1]), y: Number(m555[2]), z: maxLayerZ };
}
