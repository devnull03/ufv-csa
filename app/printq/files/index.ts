import "server-only";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { printqEnv } from "../env";
import { PrintQError } from "../errors";

/** Storage for uploaded G-code and extracted thumbnails. Disk today; R2/Blob can implement the same shape. */
export interface FileStore {
  save(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<{ sizeBytes: number; sha256: string }>;
  saveBytes(key: string, data: Uint8Array): Promise<void>;
  localPath(key: string): string;
  stream(key: string): ReadableStream<Uint8Array>;
  remove(key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-z]+\/[0-9a-f-]{36}\.(gcode|bgcode|png|jpg|qoi)$/;

export function diskStore(root = printqEnv().PRINTQ_UPLOAD_DIR): FileStore {
  const resolve = (key: string) => {
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid storage key: ${key}`);
    return path.join(root, key);
  };

  return {
    async save(key, body, maxBytes) {
      const target = resolve(key);
      await mkdir(path.dirname(target), { recursive: true });
      const hash = createHash("sha256");
      let sizeBytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          sizeBytes += chunk.length;
          if (sizeBytes > maxBytes) {
            callback(new PrintQError("too_large", `Files must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller`));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      try {
        await pipeline(
          Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
          meter,
          createWriteStream(target, { flags: "wx", mode: 0o640 })
        );
      } catch (error) {
        await rm(target, { force: true });
        throw error;
      }
      return { sizeBytes, sha256: hash.digest("hex") };
    },
    async saveBytes(key, data) {
      const target = resolve(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data, { flag: "wx", mode: 0o640 });
    },
    localPath: resolve,
    stream(key) {
      return Readable.toWeb(createReadStream(resolve(key))) as ReadableStream<Uint8Array>;
    },
    async remove(key) {
      await rm(resolve(key), { force: true });
    },
  };
}
