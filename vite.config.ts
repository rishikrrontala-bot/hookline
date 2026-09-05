import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, so the build needs a base
  // path. Local dev stays at the root — VITE_BASE is only set in CI.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: { port: 5273, host: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: { three: ['three', '@react-three/fiber', '@react-three/drei'] },
      },
    },
  },
});
