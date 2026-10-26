// Downloads the catalog entries the app uses into models-raw/<setId>/<folder>/<filename>: every
// render:true entry plus the High Clearance variants (the Pack download needs those STLs too).
// Usage: node scripts/fetch-models.mjs [--all]   (--all also fetches the decor sets)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDownloadLink } from './printables-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RAW_DIR = path.join(ROOT, 'models-raw');
const CONCURRENCY = 4;
const RETRIES = 3;

export function rawPath(entry) {
  return path.join(RAW_DIR, entry.set, entry.folder ?? '', entry.filename);
}

async function exists(p) {
  try { return (await fs.stat(p)).size > 0; } catch { return false; }
}

async function downloadOne(entry) {
  const dest = rawPath(entry);
  if (await exists(dest)) return 'skipped';
  await fs.mkdir(path.dirname(dest), { recursive: true });
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const link = await getDownloadLink(entry.fileId, entry.set);
      const res = await fetch(link, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error('empty body');
      const tmp = dest + '.part';
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, dest);
      return 'downloaded';
    } catch (err) {
      lastErr = err;
      console.warn(`  retry ${attempt}/${RETRIES} ${entry.key}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}

async function main() {
  const all = process.argv.includes('--all');
  const catalog = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts', 'catalog.json'), 'utf8'));
  const todo = catalog.filter((e) => all || e.render || e.variant === 'clearance');
  console.log(`${todo.length} files to check (${(todo.reduce((n, e) => n + e.fileSize, 0) / 1e6).toFixed(1)} MB)`);

  const counts = { downloaded: 0, skipped: 0, failed: 0 };
  const failures = [];
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const entry = todo[next++];
      try {
        const r = await downloadOne(entry);
        counts[r]++;
        console.log(`[${counts.downloaded + counts.skipped + counts.failed}/${todo.length}] ${r.padEnd(10)} ${entry.key} (${(entry.fileSize / 1e6).toFixed(1)} MB)`);
      } catch (err) {
        counts.failed++;
        failures.push(`${entry.key}: ${err.message}`);
        console.error(`FAILED ${entry.key}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\nDone: ${counts.downloaded} downloaded, ${counts.skipped} skipped, ${counts.failed} failed -> ${RAW_DIR}`);
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => { console.error(err); process.exit(1); });
