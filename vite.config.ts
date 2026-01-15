import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  return {
    // If we are running 'npm run build', use the repo name. 
    // If we are running 'npm run dev', use the root '/'.
    base: command === 'build' ? '/game_defender/' : '/',
    build: {
      outDir: 'dist',
    },
  };
});
