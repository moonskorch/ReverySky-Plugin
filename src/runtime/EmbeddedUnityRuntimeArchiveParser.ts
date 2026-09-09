import { Parser as TarParser } from "tar/parse";
import type { ReadEntry } from "tar/read-entry";

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

export async function readArchiveEntryBuffer(entry: ReadEntry): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    entry.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
    });
    entry.on("end", resolve);
    entry.on("error", reject);
  });
  return Buffer.concat(chunks);
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

  parser.end(archiveBuffer);
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
