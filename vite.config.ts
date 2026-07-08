import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: true,  // Show runtime errors in browser during development
    },
    proxy: {
      "/api": {
        // Use 127.0.0.1, not "localhost": on Windows "localhost" resolves to
        // IPv6 ::1 first, but Flask only listens on IPv4, so every request
        // wastes ~200ms on the connection-refused fallback. 127.0.0.1 = ~3ms.
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
