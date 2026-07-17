/**
 * Accessors for the `embedded-archive` release package mode.
 *
 * `scripts/package-embedded-archive.mjs` injects two window functions into
 * root `main.js`: one returns the compressed Unity WebGL archive as base64,
 * and the other returns the expected SHA-256. The installer reads both values
 * here before extracting the runtime into a versioned local cache.
 */
const EMBEDDED_RUNTIME_ARCHIVE_BASE64_KEY =
  "__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_BASE64__";
const EMBEDDED_RUNTIME_ARCHIVE_SHA256_KEY =
  "__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_SHA256__";

type WindowWithEmbeddedRuntimeArchive = Window & {
  __REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_BASE64__?: unknown;
  __REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_SHA256__?: unknown;
};

type EmbeddedRuntimeArchiveGetter = () => unknown;

function readEmbeddedArchiveValue(key: string): string | null {
  const value = (window as WindowWithEmbeddedRuntimeArchive)[key as
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
    typeof (window as WindowWithEmbeddedRuntimeArchive)[
      EMBEDDED_RUNTIME_ARCHIVE_BASE64_KEY
    ] === "function" &&
    typeof (window as WindowWithEmbeddedRuntimeArchive)[
      EMBEDDED_RUNTIME_ARCHIVE_SHA256_KEY
    ] === "function"
  );
}
