import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const uplotDist = join(dirname(require.resolve("uplot/package.json")), "dist");
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "vendor");

const files = ["uPlot.esm.js", "uPlot.min.css"];

mkdirSync(target, { recursive: true });
for (const file of files) copyFileSync(join(uplotDist, file), join(target, file));
console.log(`vendored ${files.join(", ")} into ${target}`);
