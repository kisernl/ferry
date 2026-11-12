import { readFileSync } from "node:fs";
import { build } from "esbuild";

const deps = Object.keys(
  JSON.parse(readFileSync("package.json", "utf8")).dependencies ?? {},
);
// Externalize real npm deps (name + subpaths); bundle workspace pkgs like @ferry/shared
const external = deps.filter((d) => !d.startsWith("@ferry/")).flatMap((d) => [d, `${d}/*`]);

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/index.js",
  external,
  banner: {
    js: 'import{createRequire}from"module";const require=createRequire(import.meta.url);',
  },
});
