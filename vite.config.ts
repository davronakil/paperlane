import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs so the bundle can be served from any path — the native
  // shell serves it under a random per-launch prefix on a loopback port.
  base: './',
});
