import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // Please make sure that '@tanstack/router-plugin' is passed before '@vitejs/plugin-react'
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    watch: {
      usePolling: true,
    },
    // Mirror prod's same-origin layout: in prod nginx forwards /api -> backend,
    // here Vite does the same. Means the CLI / dev fetch code only ever needs
    // one URL (the UI's), instead of juggling API on :3000 and UI on :5173.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
