import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Three.js is intentionally deferred as one cacheable scene chunk; it
    // currently builds at ~709 kB, so warn only when it grows beyond that.
    chunkSizeWarningLimit: 768,
  },
  resolve: {
    alias: {
      "gcode-parser": fileURLToPath(new URL("./src/vendor/gcode-parser-browser.js", import.meta.url)),
    },
  },
});
