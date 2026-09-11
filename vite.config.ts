import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Tauri serves the built assets from `dist`, and drives the dev server on a
// fixed port so the Rust side can point the webview at it.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // WebView2 on Windows 10/11 is evergreen Chromium, so there is no reason
    // to ship transpiled-down output.
    target: "chrome110",
    sourcemap: false,
    minify: "esbuild",
  },
});
