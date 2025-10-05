import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    open: true,
    host: true,
    // Allow these origins for CORS during development (can be expanded as needed)
    cors: {
      origin: [
        "http://webscore.graysmal.com",
        "http://localhost:5173", // vite default
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000"
      ]
    },
    // Allowed hosts for incoming dev-server connections
    allowedHosts: ["webscore.graysmal.com", "localhost", "127.0.0.1"],

    // Proxy `/api/*` requests to the backend API server running on port 3000.
    // The rewrite removes the `/api` prefix so a request to `/api/youtube-to-midi`
    // is forwarded as `http://localhost:3000/youtube-to-midi`.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
