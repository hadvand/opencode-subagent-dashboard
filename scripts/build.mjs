import { transformAsync } from "@babel/core"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import ts from "@babel/preset-typescript"
import solid from "babel-preset-solid"
import { build } from "esbuild"

// The TUI part must use the same Solid transform as OpenCode itself:
// Babel's Solid preset with helper imports from `@opentui/solid`.
// Compiling JSX to `@opentui/solid/jsx-runtime` creates a second
// reactivity instance when the plugin is installed as a package.
const source = await readFile("src/tui.tsx", "utf8")
const transformed = await transformAsync(source, {
  filename: "src/tui.tsx",
  configFile: false,
  babelrc: false,
  sourceMaps: false,
  presets: [
    [solid, { moduleName: "@opentui/solid", generate: "universal" }],
    [ts, {}],
  ],
})

await mkdir("dist", { recursive: true })
await writeFile("dist/tui.js", transformed?.code ?? source)

await build({
  entryPoints: ["src/index.ts"],
  outdir: "dist",
  outbase: "src",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@opencode/plugin", "@opencode/plugin/*"],
  logLevel: "info",
})
