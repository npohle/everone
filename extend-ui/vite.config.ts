import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const require = createRequire(import.meta.url)

// Tailwind's preflight reset, confined to the component (see src/styles.css):
// replaces the `@import "virtual:scoped-preflight.css" layer(base);` line
// before Tailwind sees the file. `html, :host` becomes the scope root,
// everything else applies unchanged within the scope.
function scopedPreflight(): Plugin {
  const placeholder = '@import "virtual:scoped-preflight.css" layer(base);'
  return {
    name: "scoped-preflight",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/src/styles.css") || !code.includes(placeholder)) {
        return null
      }
      const preflight = readFileSync(
        require.resolve("tailwindcss/preflight.css"),
        "utf8"
      ).replace(/^html,\n:host \{/m, ":scope {")
      if (!preflight.includes(":scope {")) {
        throw new Error("tailwindcss/preflight.css no longer has `html, :host`")
      }
      return code.replace(
        placeholder,
        `@layer base {\n@scope (.extend-ui, [data-slot]) {\n${preflight}\n}\n}`
      )
    },
  }
}

export default defineConfig({
  plugins: [scopedPreflight(), react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "../vendor/extend-ui",
    emptyOutDir: true,
    lib: {
      entry: "src/main.tsx",
      formats: ["es"],
      fileName: () => "file-system.js",
      cssFileName: "file-system",
    },
    // Lib mode keeps "es" output unminified by default; this bundle is
    // served as-is.
    rolldownOptions: { output: { codeSplitting: false, minify: true } },
  },
})
