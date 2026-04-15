import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    background: "src/background/index.ts",
    content: "src/content/index.ts",
    popup: "src/popup/index.ts"
  },
  format: ["iife"],
  outDir: "dist",
  clean: true,
  minify: false,
  sourcemap: true,
  target: "es2022",
  splitting: false,
  dts: false
})
