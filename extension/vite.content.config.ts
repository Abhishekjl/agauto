import { defineConfig } from "vite";

// Builds the content script as a single self-contained IIFE (classic script),
// since manifest-declared content scripts cannot be ES modules.
// emptyOutDir:false so it appends to the side-panel build in dist/.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/content/index.ts",
      formats: ["iife"],
      name: "AgautoContent",
      fileName: () => "content.js",
    },
    rollupOptions: {
      output: { extend: true },
    },
  },
});
