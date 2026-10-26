import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * The original STLs for the "Pack" download: served from models-raw/ at /stl/<set>/<folder>/<file>
 * by the dev server, and copied into dist/stl on build (set NO_STL=1 to skip the copy).
 */
function f2iStl() {
  const RAW = path.join(ROOT, 'models-raw');
  return {
    name: 'f2i-stl',
    configureServer(server) {
      server.middlewares.use('/stl', async (req, res) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = path.normalize(path.join(RAW, rel));
        if (!file.startsWith(RAW + path.sep)) {
          res.statusCode = 403;
          return res.end();
        }
        try {
          const st = await fs.stat(file);
          if (!st.isFile()) throw new Error('not a file');
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Content-Length', String(st.size));
          createReadStream(file).pipe(res);
        } catch {
          res.statusCode = 404;
          res.end('not found');
        }
      });
    },
    async closeBundle() {
      if (process.env.NO_STL) return;
      try {
        await fs.access(RAW);
      } catch {
        console.warn('[f2i-stl] models-raw/ not found: the built site will have no STL pack download (run npm run fetch-models)');
        return;
      }
      await fs.cp(RAW, path.join(ROOT, 'dist', 'stl'), { recursive: true });
      console.log('[f2i-stl] copied models-raw/ to dist/stl');
    },
  };
}

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
  plugins: [tailwindcss(), f2iDevSave(), f2iStl()],
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
