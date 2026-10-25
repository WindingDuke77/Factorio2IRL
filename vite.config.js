import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Dev only: the ?dev tuning panel POSTs part/composite/levels JSON here to save it to src/config. */
function f2iDevSave() {
  return {
    name: 'f2i-dev-save',
    configureServer(server) {
      server.middlewares.use('/__f2i/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');
          try {
            const { kind, name, data } = JSON.parse(body);
            const safe = String(name ?? '').replace(/[^a-z0-9_\-]/gi, '');
            let file;
            if (kind === 'part') file = `src/config/parts/${safe}.json`;
            else if (kind === 'composite') file = `src/config/composites/${safe}.json`;
            else if (kind === 'levels') file = 'src/config/levels.json';
            else throw new Error('unknown kind');
            await fs.writeFile(path.join(ROOT, file), JSON.stringify(data, null, 2) + '\n');
            res.end(JSON.stringify({ ok: true, file }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
      });
    },
  };
}

// BASE_PATH lets the same build be served from a sub-path (e.g. GitHub Pages: BASE_PATH=/Factorio2IRL/).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [tailwindcss(), f2iDevSave()],
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
