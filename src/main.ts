import { Game } from './core/Game';
import { AssetRegistry } from './core/AssetRegistry';

window.addEventListener('DOMContentLoaded', async () => {
  // Show a simple loading state if needed, but for now we just wait
  const registry = AssetRegistry.getInstance();
  await registry.loadAll();
  
  new Game('app');
});
