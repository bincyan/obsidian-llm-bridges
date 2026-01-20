import esbuild from "esbuild";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, "mcp-contracts-runner.ts");
const outfile = path.join(__dirname, ".mcp-contracts.bundle.cjs");
const obsidianMock = path.resolve(__dirname, "../tests/mocks/obsidian.ts");

const obsidianAlias = {
  name: "alias-obsidian",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: obsidianMock }));
  },
};

try {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    external: ["electron"],
    plugins: [obsidianAlias],
  });

  const { run } = await import(pathToFileURL(outfile).href);
  if (typeof run !== "function") {
    throw new Error("Runner did not export run()");
  }
  await run();
} finally {
  await fs.rm(outfile, { force: true });
}
