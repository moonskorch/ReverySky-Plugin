/**
 * Accessor for the legacy `embedded-html` package mode.
 *
 * `scripts/package-embedded-html.mjs` injects the complete generated Unity
 * host page into root `main.js` as a window global. At runtime the plugin can
 * serve that HTML directly from memory instead of reading a `unity-webgl/`
 * folder from disk.
 */
const EMBEDDED_UNITY_INDEX_HTML_GLOBAL_KEY =
  "__REVERYSKY_EMBEDDED_UNITY_INDEX_HTML__";

type WindowWithEmbeddedUnityIndexHtml = Window & {
  __REVERYSKY_EMBEDDED_UNITY_INDEX_HTML__?: unknown;
};

export function getEmbeddedUnityIndexHtml(): string | null {
  const value = (
    window as WindowWithEmbeddedUnityIndexHtml
  )[EMBEDDED_UNITY_INDEX_HTML_GLOBAL_KEY];

  return typeof value === "string" && value.length > 0 ? value : null;
}
