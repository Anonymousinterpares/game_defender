import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // This ensures links work regardless of the URL subfolder
  build: {
    outDir: 'dist',
  },
});
