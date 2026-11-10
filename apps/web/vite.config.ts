import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  // Static hosting under a sub-path (GitHub Pages) sets VITE_BASE=/sudoku-world-cup/.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in development too, so the session cookie reaches both REST and Socket.io.
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/socket.io': { target: api, ws: true, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
