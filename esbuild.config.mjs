import esbuild from "esbuild";
import process from "node:process";
import path from "node:path";

const production = process.argv[2] === "production";
const entryMain = path.join(process.cwd(), "src", "main.ts");

const context = await esbuild.context({
  entryPoints: [entryMain],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2020",
  external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view"],
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js"
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
