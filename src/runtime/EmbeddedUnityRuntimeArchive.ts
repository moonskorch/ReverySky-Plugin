const EMBEDDED_RUNTIME_ARCHIVE_BASE64_KEY =
  "__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_BASE64__";
const EMBEDDED_RUNTIME_ARCHIVE_SHA256_KEY =
  "__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_SHA256__";

type GlobalWithEmbeddedRuntimeArchive = typeof globalThis & {
  __REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_BASE64__?: unknown;
  __REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_SHA256__?: unknown;
};

type EmbeddedRuntimeArchiveGetter = () => unknown;

function readEmbeddedArchiveValue(key: string): string | null {
  const value = (globalThis as GlobalWithEmbeddedRuntimeArchive)[key as
    | typeof EMBEDDED_RUNTIME_ARCHIVE_BASE64_KEY
    | typeof EMBEDDED_RUNTIME_ARCHIVE_SHA256_KEY] as EmbeddedRuntimeArchiveGetter | undefined;

  if (typeof value !== "function") {
    return null;
  }

  try {
    const result = value();
    return typeof result === "string" && result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

export function getEmbeddedUnityRuntimeArchiveBase64(): string | null {
  return readEmbeddedArchiveValue(EMBEDDED_RUNTIME_ARCHIVE_BASE64_KEY);
}

export function getEmbeddedUnityRuntimeArchiveSha256(): string | null {
  return readEmbeddedArchiveValue(EMBEDDED_RUNTIME_ARCHIVE_SHA256_KEY);
}

export function hasEmbeddedUnityRuntimeArchive(): boolean {
  return (
    typeof (globalThis as GlobalWithEmbeddedRuntimeArchive)[
      EMBEDDED_RUNTIME_ARCHIVE_BASE64_KEY
    ] === "function" &&
    typeof (globalThis as GlobalWithEmbeddedRuntimeArchive)[
      EMBEDDED_RUNTIME_ARCHIVE_SHA256_KEY
    ] === "function"
  );
}
