import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// BASE_PATH lets the same build be served from a sub-path (e.g. GitHub Pages: BASE_PATH=/Factorio2IRL/).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [tailwindcss()],
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
