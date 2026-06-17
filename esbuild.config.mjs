import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname);

export async function runEsbuildBuild(production) {
  const entryMain = path.join(repoRoot, "src", "main.ts");
  const outputMain = path.join(repoRoot, "main.js");

  const context = await esbuild.context({
    absWorkingDir: repoRoot,
    entryPoints: [entryMain],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "es2020",
    external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view"],
    define: {
      "process.env.TESTING_TAR_FAKE_PLATFORM": "undefined",
      "process.env.__FAKE_PLATFORM__": "undefined",
      "process.env.__FAKE_FS_O_FILENAME__": "undefined"
    },
    logLevel: "info",
    sourcemap: production ? false : "inline",
    treeShaking: true,
    outfile: outputMain
  });

  if (production) {
    await context.rebuild();
    await context.dispose();
    return;
  }

  await context.watch();
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectExecution) {
  await runEsbuildBuild(process.argv[2] === "production");
}
