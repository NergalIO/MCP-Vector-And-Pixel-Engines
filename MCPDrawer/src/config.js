// Settings shared by the HTTP server and the MCP process.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PORT = Number(process.env.PIXELFORGE_PORT || 7420);
export const DATA_DIR = process.env.PIXELFORGE_DATA || path.join(ROOT, 'data', 'sprites');
export const HOME_DIR = path.dirname(DATA_DIR);
export const TOKEN_FILE = path.join(HOME_DIR, 'token');
export const VERSION = '1.1.0';
export const TOKEN_HEADER = 'x-pixelforge-token';

// Hash of the app's source files: lets the MCP process detect a server running outdated code.
export function computeBuild() {
  const h = crypto.createHash('sha1');
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html|css)$/.test(e.name)) h.update(e.name).update(fs.readFileSync(p));
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'public'));
  return h.digest('hex').slice(0, 12);
}
export const BUILD = computeBuild();

export function readToken() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim() || null; } catch { return null; }
}

export function ensureToken() {
  const existing = readToken();
  if (existing) return existing;
  fs.mkdirSync(HOME_DIR, { recursive: true });
  const t = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  return t;
}
