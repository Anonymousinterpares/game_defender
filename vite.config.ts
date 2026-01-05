import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  return {
    // If we are building for production (npm run deploy), use the repo name.
    // Otherwise (npm run dev), use the root.
    base: command === 'build' ? '/game_defender/' : '/',
    build: {
      outDir: 'dist',
    },
  };
});
