import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UnityWebglLocalServer } from "../../src/runtime/UnityWebglLocalServer";

async function withServer<T>(
  source: ConstructorParameters<typeof UnityWebglLocalServer>[0],
  fn: (baseUrl: string) => Promise<T>
): Promise<T> {
  const server = new UnityWebglLocalServer(source);
  const baseUrl = await server.getBaseUrl();
  try {
    return await fn(baseUrl);
  } finally {
    await server.stop();
  }
}

describe("UnityWebglLocalServer", () => {
  it("keeps directory mode serving disk HTML", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "reverysky-webgl-dir-"));
    const html = "<!doctype html><html><body>disk</body></html>";
    try {
      await writeFile(path.join(rootDir, "index.html"), html, "utf8");

      await withServer({ kind: "directory", rootDir }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/index.html`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(html, "utf8")));
        expect(await response.text()).toBe(html);
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("serves embedded HTML from memory without a disk runtime folder", async () => {
    const html = "<!doctype html><html>embedded</html>";
    await withServer({ kind: "embedded-index", indexHtml: html }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(html, "utf8")));
      expect(await response.text()).toBe(html);
    });
  });

  it("supports HEAD requests for embedded index.html", async () => {
    const html = "<!doctype html><html>head</html>";
    await withServer({ kind: "embedded-index", indexHtml: html }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/index.html`, { method: "HEAD" });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(html, "utf8")));
      expect(await response.text()).toBe("");
    });
  });

  it("rejects external file paths in embedded mode", async () => {
    await withServer(
      { kind: "embedded-index", indexHtml: "<!doctype html><html>embedded</html>" },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/Build/runtime-code.wasm`);
        expect(response.status).toBe(404);
      }
    );
  });
});
