import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Phase 0: plain Vite build of the side-panel React app.
// `base: "./"` makes asset paths relative so they resolve under chrome-extension://.
// `public/` (manifest.json, background.js) is copied verbatim into dist/.
// Phase 1 will introduce content scripts (likely via @crxjs/vite-plugin).
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
