import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));

export default defineConfig(({ command }) => {
  return {
    // If we are running 'npm run build', use the repo name. 
    // If we are running 'npm run dev', use the root '/'.
    base: command === 'build' ? '/game_defender/' : '/',
    build: {
      outDir: 'dist',
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  };
});
