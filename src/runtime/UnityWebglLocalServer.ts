import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".data": "application/octet-stream",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm"
};

export type UnityWebglRuntimeSource =
  | {
      kind: "directory";
      rootDir: string;
    }
  | {
      kind: "embedded-index";
      indexHtml: string;
    };

/**
 * Serve the generated Unity WebGL export from localhost for the iframe runtime.
 */
export class UnityWebglLocalServer {
  private server: Server | null = null;
  private baseUrl: string | null = null;
  private startPromise: Promise<string> | null = null;
  private readonly source: UnityWebglRuntimeSource;

  constructor(source: UnityWebglRuntimeSource) {
    this.source = source.kind === "directory"
      ? {
          ...source,
          rootDir: path.resolve(source.rootDir)
        }
      : source;
  }

  /**
   * Start the server once and reuse the same address for all iframe loads.
   */
  async getBaseUrl(): Promise<string> {
    if (this.baseUrl) {
      return this.baseUrl;
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startServer();
    try {
      this.baseUrl = await this.startPromise;
      return this.baseUrl;
    } finally {
      this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const activeServer = this.server;
    this.server = null;
    this.baseUrl = null;

    await new Promise<void>((resolve) => {
      activeServer.close(() => resolve());
    });
  }

  /**
   * Bind to 127.0.0.1 on a random port to avoid collisions with other services.
   */
  private startServer(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      server.once("error", (err) => {
        reject(err);
      });

      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to resolve local server address."));
          return;
        }

        this.server = server;
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
  }

  /**
   * Keep the host locked down to GET/HEAD and map requests to the export root.
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.statusCode = 405;
        res.end("Method not allowed");
        return;
      }

      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (this.source.kind === "embedded-index") {
        await this.handleEmbeddedRequest(requestUrl.pathname, req.method, res);
        return;
      }

      const safePath = this.resolveRequestPath(requestUrl.pathname);
      if (!safePath) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
      }

      let filePath = safePath;
      let fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        filePath = path.join(filePath, "index.html");
        fileStat = await stat(filePath);
      }

      res.statusCode = 200;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Length", String(fileStat.size));
      res.setHeader("Content-Type", CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream");

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      createReadStream(filePath)
        .on("error", () => {
          if (!res.headersSent) {
            res.statusCode = 500;
          }
          res.end("Read error");
        })
        .pipe(res);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      res.statusCode = code === "ENOENT" ? 404 : 500;
      res.end(code === "ENOENT" ? "Not found" : "Server error");
    }
  }

  private async handleEmbeddedRequest(
    pathnameRaw: string,
    method: string,
    res: ServerResponse
  ): Promise<void> {
    const pathname = pathnameRaw === "/" ? "/index.html" : pathnameRaw;
    if (pathname !== "/index.html") {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    const indexHtml = this.source.kind === "embedded-index" ? this.source.indexHtml : "";
    const contentLength = Buffer.byteLength(indexHtml, "utf8");
    res.statusCode = 200;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(contentLength));
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    if (method === "HEAD") {
      res.end();
      return;
    }

    res.end(indexHtml);
  }

  /**
   * Normalize and validate the path to block traversal outside the export directory.
   */
  private resolveRequestPath(pathnameRaw: string): string | null {
    const pathname = pathnameRaw === "/" ? "/index.html" : pathnameRaw;
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes("\0")) {
      return null;
    }

    if (this.source.kind !== "directory") {
      return null;
    }

    const rootDirResolved = this.source.rootDir;
    const relativePath = path.normalize(decoded).replace(/^[\\/]+/, "");
    const absolutePath = path.resolve(rootDirResolved, relativePath);
    const rootWithSep = rootDirResolved.endsWith(path.sep) ? rootDirResolved : `${rootDirResolved}${path.sep}`;
    if (absolutePath !== rootDirResolved && !absolutePath.startsWith(rootWithSep)) {
      return null;
    }
    return absolutePath;
  }
}
