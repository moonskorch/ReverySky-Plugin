const EMBEDDED_UNITY_INDEX_HTML_GLOBAL_KEY =
  "__REVERYSKY_EMBEDDED_UNITY_INDEX_HTML__";

type GlobalWithEmbeddedUnityIndexHtml = typeof globalThis & {
  __REVERYSKY_EMBEDDED_UNITY_INDEX_HTML__?: unknown;
};

export function getEmbeddedUnityIndexHtml(): string | null {
  const value = (
    globalThis as GlobalWithEmbeddedUnityIndexHtml
  )[EMBEDDED_UNITY_INDEX_HTML_GLOBAL_KEY];

  return typeof value === "string" && value.length > 0 ? value : null;
}
