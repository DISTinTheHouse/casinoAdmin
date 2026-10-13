// node --test : la caja sirve a las máquinas solo versiones más nuevas, con su firma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BJ_UPDATES = mkdtempSync(join(tmpdir(), 'act-'));
const { newer, handle } = await import('../updates.js');

const call = (path) => {
  const out = {};
  handle({ headers: { host: '192.168.1.10:7021' } }, { writeHead: (s) => { out.status = s; }, end: (b) => { out.body = b && JSON.parse(b); } }, new URL(path, 'http://x'));
  return out;
};

test('compara versiones', () => {
  assert.ok(newer('1.2.0', '1.1.9'));
  assert.ok(newer('v1.10.0', '1.9.0'));
  assert.ok(!newer('1.1.0', '1.1.0'));
  assert.ok(!newer('1.0.1', '1.1.0'));
});

test('sin versión bajada o ya al día responde 204; si hay nueva manda url y firma', () => {
  assert.equal(call('/api/update/game/1.0.1').status, 204);
  const dir = process.env.BJ_UPDATES;
  mkdirSync(join(dir, '1.1.0'));
  writeFileSync(join(dir, '1.1.0', '21 Blackjack_1.1.0_x64-setup.exe'), 'x');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version: '1.1.0', notes: '', pub_date: '2026-10-13T00:00:00Z',
    apps: { game: { file: '21 Blackjack_1.1.0_x64-setup.exe', signature: 'FIRMA' } } }));
  assert.equal(call('/api/update/game/1.1.0').status, 204);
  assert.equal(call('/api/update/holdem/1.0.1').status, 204); // esa app no viene en la versión
  const r = call('/api/update/game/1.0.1');
  assert.equal(r.status, 200);
  assert.equal(r.body.signature, 'FIRMA');
  assert.equal(r.body.url, 'http://192.168.1.10:7021/api/update/file/game');
});

test('reconoce los instaladores firmados aunque GitHub cambie espacios por puntos', async () => {
  const { assetsOf } = await import('../updates.js');
  const a = (name) => ({ name, browser_download_url: name });
  const apps = assetsOf([a('21.Blackjack_1.2.0_x64-setup.exe'), a('21.Blackjack_1.2.0_x64-setup.exe.sig'),
    a('21.Blackjack.Admin_1.2.0_x64-setup.exe'), a('21.Blackjack.Admin_1.2.0_x64-setup.exe.sig'), a('Texas.Holdem_1.2.0_x64-setup.exe')]);
  assert.deepEqual(Object.keys(apps).sort(), ['admin', 'game']); // Hold'em sin firma no cuenta
  assert.equal(apps.game.exe.name, '21.Blackjack_1.2.0_x64-setup.exe');
  assert.equal(apps.admin.version, '1.2.0');
});
