import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'local-file-system',
          configureServer(server) {
            server.middlewares.use('/api/config', (req, res, next) => {
              if (req.method === 'GET') {
                const configPath = path.resolve(__dirname, 'config.json');
                res.setHeader('Content-Type', 'application/json');
                if (fs.existsSync(configPath)) {
                  res.end(fs.readFileSync(configPath));
                } else {
                  res.end(JSON.stringify({ lastSavePath: '' }));
                }
                return;
              } else if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                  try {
                    const newConfig = JSON.parse(body);
                    fs.writeFileSync(path.resolve(__dirname, 'config.json'), JSON.stringify(newConfig, null, 2));
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: true }));
                  } catch (e) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                  }
                });
                return;
              }
              next();
            });

            server.middlewares.use('/api/save', (req, res, next) => {
              if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                  try {
                    const { filename, path: savePath, data } = JSON.parse(body);
                    if (!filename || !savePath || !data) {
                        throw new Error('Missing required fields: filename, path, or data');
                    }
                    
                    const fullPath = path.join(savePath, filename.endsWith('.json') ? filename : `${filename}.json`);
                    
                    // Ensure directory exists
                    if (!fs.existsSync(savePath)) {
                        fs.mkdirSync(savePath, { recursive: true });
                    }

                    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
                    
                    // Update last path in config
                    const configPath = path.resolve(__dirname, 'config.json');
                    fs.writeFileSync(configPath, JSON.stringify({ lastSavePath: savePath }, null, 2));

                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: true, fullPath }));
                  } catch (err) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: err.message }));
                  }
                });
                return;
              }
              next();
            });
          }
        }
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
