import { open } from "node:fs/promises";
import { parseGcode, type ByteSource, type ParsedGcode } from "./parse";

export { GcodeParseError, parseDuration } from "./parse";
export { fitsBuildVolume, printerModelMatches } from "./model";
export type { ParsedGcode, Thumbnail } from "./parse";

export function bufferSource(buffer: Uint8Array): ByteSource {
  return {
    size: buffer.byteLength,
    async read(offset, length) {
      return buffer.subarray(offset, Math.min(buffer.byteLength, offset + length));
    },
  };
}

export async function parseGcodeFile(path: string): Promise<ParsedGcode> {
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
