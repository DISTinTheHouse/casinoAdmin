// Actualizaciones de las apps: la PC de caja baja la última versión publicada en GitHub (desde el admin)
// y las máquinas la piden aquí por la red local. Cada instalador va firmado; la app solo instala si la firma cuadra.
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO = process.env.BJ_UPDATES_REPO || 'DISTinTheHouse/casinoAdmin';
export const DIR = process.env.BJ_UPDATES || fileURLToPath(new URL('./actualizaciones', import.meta.url));
// Nombre con que el workflow publica cada instalador: "<producto>_<versión>_x64-setup.exe" (GitHub cambia los espacios por puntos).
export const APPS = { game: '21 Blackjack', holdem: 'Texas Holdem', admin: '21 Blackjack Admin' };

const parse = (v) => String(v || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
export const newer = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] || 0) > (y[i] || 0); return false; };

export function local() {
  try { return JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')); } catch { return null; }
}

async function gh(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers: { 'User-Agent': 'blackjack-server', Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(res.status === 404 ? 'Aún no hay versiones publicadas' : `GitHub respondió ${res.status}`);
  return res.json();
}

// Última versión publicada y qué apps trae con firma (sin firma no se puede instalar sola).
// La versión de cada app sale del nombre de su instalador, que es la que la app trae por dentro.
export function assetsOf(assets) {
  const apps = {};
  for (const [app, product] of Object.entries(APPS)) {
    const re = new RegExp(`^${product.replace(/ /g, '\\.')}_(\\d+\\.\\d+\\.\\d+)_x64-setup\\.exe$`);
    const exe = assets.find((a) => re.test(a.name.replace(/ /g, '.')));
    const sig = exe && assets.find((a) => a.name === `${exe.name}.sig`);
    if (exe && sig) apps[app] = { exe, sig, version: re.exec(exe.name.replace(/ /g, '.'))[1] };
  }
  return apps;
}

export async function latest() {
  const r = await gh('/releases/latest');
  const version = r.tag_name.replace(/^v/, '');
  const apps = assetsOf(r.assets);
  return { version, notes: r.body || '', pub_date: r.published_at, apps };
}

// Baja los instaladores firmados de la última versión a actualizaciones/ y la deja lista para las máquinas.
export async function download() {
  const l = await latest();
  if (!Object.keys(l.apps).length) throw new Error(`La versión ${l.version} no trae instaladores firmados. Revisa la clave de firma en GitHub.`);
  const tmp = join(DIR, `.${l.version}`), dest = join(DIR, l.version);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const apps = {};
  for (const [app, { exe, sig, version }] of Object.entries(l.apps)) {
    const bin = await fetch(exe.browser_download_url, { headers: { 'User-Agent': 'blackjack-server' } });
    if (!bin.ok) throw new Error(`No se pudo bajar ${exe.name}`);
    writeFileSync(join(tmp, exe.name), Buffer.from(await bin.arrayBuffer()));
    const signature = await (await fetch(sig.browser_download_url, { headers: { 'User-Agent': 'blackjack-server' } })).text();
    apps[app] = { file: exe.name, version, signature: signature.trim() };
  }
  rmSync(dest, { recursive: true, force: true });
  renameSync(tmp, dest);
  const manifest = { version: l.version, notes: l.notes, pub_date: l.pub_date, downloaded_at: new Date().toISOString(), apps };
  writeFileSync(join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

// GET /api/update/<app>/<versión actual>  → 204 si está al día, o el formato que espera el actualizador de Tauri.
// GET /api/update/file/<app>              → el instalador.
export function handle(req, res, url) {
  const [, , , a, b] = url.pathname.split('/');
  const m = local();
  if (a === 'file') {
    const f = m?.apps[b] && join(DIR, m.version, m.apps[b].file);
    if (!f || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': statSync(f).size });
    return createReadStream(f).pipe(res);
  }
  const entry = m?.apps[a];
  const version = entry?.version || m?.version;
  if (!entry || !newer(version, decodeURIComponent(b || ''))) { res.writeHead(204); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ version, notes: m.notes, pub_date: m.pub_date, signature: entry.signature,
    url: `http://${req.headers.host}/api/update/file/${a}` }));
}
