import { Parser as TarParser } from "tar/parse";
import type { ReadEntry } from "tar/read-entry";

const ARCHIVE_WRITE_CHUNK_BYTES = 64 * 1024;

export type EmbeddedRuntimeArchiveEntry = {
  path: string;
  type?: string;
  typeKey?: string;
  linkpath?: string;
  meta?: boolean;
};

export function createArchiveEntry(entry: ReadEntry): EmbeddedRuntimeArchiveEntry {
  return {
    path: entry.path,
    type: entry.type,
    typeKey: (entry as { typeKey?: string }).typeKey,
    linkpath: entry.linkpath,
    meta: entry.meta
  };
}

export async function drainArchiveEntry(entry: ReadEntry): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    entry.on("end", resolve);
    entry.on("error", reject);
    entry.resume();
  });
}

export async function readArchiveEntryArrayBuffer(entry: ReadEntry): Promise<ArrayBuffer> {
  const content = new ArrayBuffer(entry.size);
  const contentBytes = new Uint8Array(content);
  let offset = 0;

  await new Promise<void>((resolve, reject) => {
    entry.on("data", (chunk: Buffer) => {
      contentBytes.set(chunk, offset);
      offset += chunk.byteLength;
    });
    entry.on("end", resolve);
    entry.on("error", reject);
  });

  if (offset !== content.byteLength) {
    throw new Error(`Embedded runtime archive entry size mismatch: ${entry.path}`);
  }

  return content;
}

async function writeArchiveChunk(parser: TarParser, chunk: Buffer): Promise<void> {
  if (parser.write(chunk)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      parser.off("drain", handleDrain);
      parser.off("error", handleError);
    };
    const handleDrain = (): void => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    parser.once("drain", handleDrain);
    parser.once("error", handleError);
  });
}

export async function parseArchiveBuffer(
  archiveBuffer: Buffer,
  onEntry: (entry: ReadEntry) => Promise<void>
): Promise<void> {
  let entryWork = Promise.resolve();
  let entryError: unknown = null;
  const parser = new TarParser({
    strict: true,
    preservePaths: true
  });

  const parserDone = new Promise<void>((resolve, reject) => {
    parser.on("end", resolve);
    parser.on("error", reject);
  });

  parser.on("entry", (entry: ReadEntry) => {
    entryWork = entryWork.then(async () => {
      if (entryError) {
        await drainArchiveEntry(entry);
        return;
      }

      await onEntry(entry);
    }).catch((error: unknown) => {
      entryError = error;
      parser.abort(error instanceof Error ? error : new Error(String(error)));
    });
  });

  for (let offset = 0; offset < archiveBuffer.byteLength; offset += ARCHIVE_WRITE_CHUNK_BYTES) {
    if (entryError) {
      break;
    }

    await writeArchiveChunk(parser, archiveBuffer.subarray(offset, offset + ARCHIVE_WRITE_CHUNK_BYTES));
  }

  parser.end();
  try {
    await parserDone;
  } catch (error) {
    throw entryError instanceof Error ? entryError : error;
  }
  await entryWork;
  if (entryError instanceof Error) {
    throw entryError;
  }
  if (entryError) {
    throw new Error(String(entryError));
  }
}

export async function collectArchiveEntries(archiveBuffer: Buffer): Promise<EmbeddedRuntimeArchiveEntry[]> {
  const entries: EmbeddedRuntimeArchiveEntry[] = [];
  await parseArchiveBuffer(archiveBuffer, async (entry) => {
    entries.push(createArchiveEntry(entry));
    await drainArchiveEntry(entry);
  });
  return entries;
}
