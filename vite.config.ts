import { defineConfig } from 'vite';

export default defineConfig(({ command, mode }) => {
  // If we are building for production, use the repo name
  const isProd = command === 'build';
  
  return {
    base: isProd ? '/game_defender/' : '/',
    build: {
      outDir: 'dist',
    },
    server: {
      port: 5173
    }
  };
});