import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const templatePaths = [
  "unity-webgl/index.template.html",
  "unity-webgl/index.disk-runtime.template.html"
];

describe("Unity WebGL runtime templates", () => {
  it.each(templatePaths)("keeps Unity boot failures visible in %s", (templatePath) => {
    const html = readFileSync(path.join(repoRoot, templatePath), "utf8");

    expect(html).toContain('const runtimeBootFailureStatus = "Unity runtime failed. Try restarting Obsidian.";');
    expect(html).toContain('const webglContextLostStatus = "WebGL context lost. Reload the map view.";');
    expect(html).toContain("const resizeDebounceMs = 200;");
    expect(html).toContain("const maxCanvasSidePixels = 8192;");
    expect(html).toContain("const maxCanvasPixels = maxCanvasSidePixels * maxCanvasSidePixels;");
    expect(html).toContain("let isRuntimeStatusLocked = false;");
    expect(html).toContain("let resizeTimerId = 0;");
    expect(html).toContain("let resizePendingDuringBoot = false;");
    expect(html).toContain("function setStatusText(text)");
    expect(html).toContain("function scheduleResizeCanvas()");
    expect(html).toContain('if (runtimeMode === "failed")');
    expect(html).toContain("function setRuntimeFailed(statusText)");
    expect(html).toContain("graphSetDispatchToken++;");
    expect(html).not.toContain("Unity runtime failed to start. See console.");

    const graphReadyBlock = html.match(/function applyGraphReady\(requestId\) \{[\s\S]*?setStatus\(formatGraphStatus\(latestGraphNoteCount, latestGraphLinkCount, false\)\);[\s\S]*?\}/)?.[0] ?? "";
    expect(graphReadyBlock).toContain('if (runtimeMode === "failed")');
    expect(graphReadyBlock).not.toContain("setStatus(webglContextLostStatus);");

    const setStatusBlock = html.match(/function setStatus\(text\) \{[\s\S]*?setStatusText\(text\);[\s\S]*?\}/)?.[0] ?? "";
    expect(setStatusBlock).toContain("if (isRuntimeStatusLocked)");

    const runtimeFailedBlock = html.match(/function setRuntimeFailed\(statusText\) \{[\s\S]*?setStatusText\(statusText\);[\s\S]*?\}/)?.[0] ?? "";
    expect(runtimeFailedBlock).toContain("isRuntimeStatusLocked = true;");
    expect(runtimeFailedBlock).toContain("setStatusText(statusText);");
    expect(runtimeFailedBlock).toContain("window.clearTimeout(resizeTimerId);");

    const contextLostBlock = html.match(/function handleWebglContextLoss\(\) \{[\s\S]*?\}/)?.[0] ?? "";
    expect(contextLostBlock).toContain("setRuntimeFailed(webglContextLostStatus);");

    const resizeBlock = html.match(/function resizeCanvas\(\) \{[\s\S]*?canvas\.height = nextHeight;[\s\S]*?\}/)?.[0] ?? "";
    expect(resizeBlock).toContain("resizeTimerId = 0;");
    expect(resizeBlock).toContain("requestedPixels > maxCanvasPixels");
    expect(resizeBlock).toContain("Math.sqrt(maxCanvasPixels / requestedPixels)");
    expect(resizeBlock).toContain("requestedWidth > maxCanvasSidePixels");
    expect(resizeBlock).toContain("maxCanvasSidePixels / requestedWidth");
    expect(resizeBlock).toContain("requestedHeight > maxCanvasSidePixels");
    expect(resizeBlock).toContain("maxCanvasSidePixels / requestedHeight");
    expect(resizeBlock).toContain("Math.min(pixelBudgetScale, widthScale, heightScale)");
    expect(resizeBlock).not.toContain("setRuntimeFailed();");

    const scheduleResizeBlock = html.match(/function scheduleResizeCanvas\(\) \{[\s\S]*?window\.setTimeout\(resizeCanvas, resizeDebounceMs\);[\s\S]*?\}/)?.[0] ?? "";
    expect(scheduleResizeBlock).toContain('if (runtimeMode === "boot")');
    expect(scheduleResizeBlock).toContain("resizePendingDuringBoot = true;");
    expect(scheduleResizeBlock).toContain("window.clearTimeout(resizeTimerId);");
    expect(scheduleResizeBlock).toContain("resizeDebounceMs");

    const windowResizeBlock = html.match(/function onWindowResize\(\) \{[\s\S]*?\}/)?.[0] ?? "";
    expect(windowResizeBlock).toContain("scheduleResizeCanvas();");
    expect(windowResizeBlock).not.toContain("resizeCanvas();");

    const bootFailureBlock = html.match(/catch \(err\) \{[\s\S]*?console\.error\("\[ReverySky\] Unity runtime boot failed\.", err\);[\s\S]*?\}/)?.[0] ?? "";
    expect(bootFailureBlock).toContain("setRuntimeFailed(runtimeBootFailureStatus);");
    expect(bootFailureBlock).not.toContain("sendReady();");

    const bootSuccessBlock = html.match(/runtimeMode = "unity";[\s\S]*?sendReady\(\);/)?.[0] ?? "";
    expect(bootSuccessBlock).toContain("if (resizePendingDuringBoot)");
    expect(bootSuccessBlock).toContain("resizePendingDuringBoot = false;");
    expect(bootSuccessBlock).toContain("scheduleResizeCanvas();");

    const shutdownBlock = html.match(/async function beginShutdown\(message\) \{[\s\S]*?window\.removeEventListener\("message", onBridgeMessage\);[\s\S]*?\}/)?.[0] ?? "";
    const syncShutdownBlock = html.match(/function beginShutdown\(message\) \{[\s\S]*?window\.removeEventListener\("message", onBridgeMessage\);[\s\S]*?\}/)?.[0] ?? "";
    expect(syncShutdownBlock).not.toBe("");
    expect(syncShutdownBlock).toContain("postShutdownComplete(requestId);");
    expect(syncShutdownBlock).toContain("window.clearTimeout(resizeTimerId);");
    expect(syncShutdownBlock).not.toContain("Quit()");

    expect(shutdownBlock).toBe("");
    expect(html).not.toContain("quitUnityRuntimeWithTimeout");
    expect(html).not.toContain("activeUnityInstance.Quit()");
    expect(html).not.toContain("Promise.race");
  });
});
