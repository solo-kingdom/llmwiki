import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8868",
      "/mcp": "http://127.0.0.1:8868",
      "/skills": "http://127.0.0.1:8868",
      "/skill.md": "http://127.0.0.1:8868",
    },
  },
})
