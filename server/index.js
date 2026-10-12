// Servidor local del 21: única fuente de verdad para saldos, manos y bitácora.
import { createServer } from 'node:http';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { DEFAULT_RULES, startRound, act, view, sha256 } from './engine.js';
import { one, all, run, tx, log, verifyLog, now, getSetting, setSetting, currentNight, backup, BACKUP_DIR } from './db.js';

const PORT = Number(process.env.BJ_PORT || 7021);
const ADMIN_PIN = () => getSetting('adminPin', process.env.BJ_ADMIN_PIN || '2121');
const rules = () => ({ ...DEFAULT_RULES, ...getSetting('rules', {}) });
const target = () => getSetting('targetPct', 15);
const limits = () => getSetting('limits', { minBet: 1000, maxBet: 100000 }); // centavos

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const pesos = (n) => Math.round(Number(n) * 100);

// ---------- Máquinas ----------
function machineOf(req, url, raw) {
  const key = req.headers['x-bj-key'];
  const m = key && all('SELECT * FROM machines').find((x) => sha256(x.token).slice(0, 16) === key);
  if (!m || !signed(req, url, raw, m.token)) fail(401, 'Máquina no registrada');
  run('UPDATE machines SET last_seen = ? WHERE id = ?', now(), m.id);
  return m;
}
const openRound = (m) => one("SELECT * FROM rounds WHERE machine_id = ? AND ended_at IS NULL", m.id);
const cardOf = (m) => m.card_uid && one('SELECT uid, name, balance FROM cards WHERE uid = ?', m.card_uid);

function machineState(m) {
  const r = openRound(m);
  return { machine: m.name, card: cardOf(m) || null, round: r ? view(JSON.parse(r.state)) : null,
    rules: rules(), limits: limits() };
}

function finishRound(roundId, st, m) {
  const payout = st.hands.reduce((s, h) => s + h.payout, 0);
  const bet = st.hands.reduce((s, h) => s + h.bet, 0);
  run('UPDATE rounds SET state = ?, payout = ?, bet = ?, ended_at = ? WHERE id = ?', JSON.stringify(st), payout, bet, now(), roundId);
  run('UPDATE cards SET balance = balance + ? WHERE uid = ?', payout, m.card_uid);
  log('mano', { round: roundId, machine: m.id, card: m.card_uid, bet, payout, seed: st.seed,
    dealer: st.dealer, hands: st.hands.map((h) => h.cards) });
}

const machineRoutes = {
  'GET /api/m/state': (m) => machineState(m),
  'POST /api/m/open': (m, { uid }) => tx(() => {
    const c = one('SELECT * FROM cards WHERE uid = ?', String(uid || '').trim());
    if (!c) fail(404, 'Tarjeta no registrada. Pásala por caja.');
    if (c.machine_id && c.machine_id !== m.id) fail(409, 'Esta tarjeta está abierta en otra máquina');
    if (m.card_uid && m.card_uid !== c.uid) fail(409, 'Termina primero el juego actual');
    run('UPDATE cards SET machine_id = ? WHERE uid = ?', m.id, c.uid);
    run('UPDATE machines SET card_uid = ? WHERE id = ?', c.uid, m.id);
    log('abre', { machine: m.id, card: c.uid, balance: c.balance });
    return machineState({ ...m, card_uid: c.uid });
  }),
  'POST /api/m/close': (m) => tx(() => {
    if (openRound(m)) fail(409, 'Termina la mano primero');
    if (m.card_uid) {
      run('UPDATE cards SET machine_id = NULL WHERE uid = ?', m.card_uid);
      run('UPDATE machines SET card_uid = NULL WHERE id = ?', m.id);
      log('cierra', { machine: m.id, card: m.card_uid });
    }
    return machineState({ ...m, card_uid: null });
  }),
  'POST /api/m/deal': (m, { bet }) => tx(() => {
    const c = cardOf(m), amount = Math.round(Number(bet));
    if (!c) fail(409, 'Acerca tu tarjeta');
    if (openRound(m)) fail(409, 'Ya hay una mano en juego');
    const { minBet, maxBet } = limits();
    if (!(amount >= minBet && amount <= maxBet)) fail(400, 'Apuesta fuera de límites');
    if (c.balance < amount) fail(402, 'Saldo insuficiente');
    run('UPDATE cards SET balance = balance - ? WHERE uid = ?', amount, c.uid);
    const st = startRound(rules(), amount);
    const id = run('INSERT INTO rounds (night_id, machine_id, card_uid, bet, state, started_at) VALUES (?, ?, ?, ?, ?, ?)',
      currentNight().id, m.id, c.uid, amount, JSON.stringify(st), now()).lastInsertRowid;
    log('reparte', { round: id, machine: m.id, card: c.uid, bet: amount, seedHash: st.seedHash });
    if (st.phase === 'done') finishRound(id, st, m);
    return { ...machineState(m), round: view(st) };
  }),
  'POST /api/m/action': (m, { action }) => tx(() => {
    const r = openRound(m);
    if (!r) fail(409, 'No hay mano en juego');
    const { st, extraBet } = act(JSON.parse(r.state), action);
    if (extraBet) {
      if (cardOf(m).balance < extraBet) fail(402, 'Saldo insuficiente');
      run('UPDATE cards SET balance = balance - ? WHERE uid = ?', extraBet, m.card_uid);
    }
    if (st.phase === 'done') finishRound(r.id, st, m);
    else run('UPDATE rounds SET state = ? WHERE id = ?', JSON.stringify(st), r.id);
    return { ...machineState(m), round: view(st) };
  }),
};

// ---------- Admin / caja ----------
function nightSummary(nightId) {
  const n = one('SELECT * FROM nights WHERE id = ?', nightId);
  const g = one('SELECT COUNT(*) hands, COALESCE(SUM(bet),0) bet, COALESCE(SUM(payout),0) paid FROM rounds WHERE night_id = ? AND ended_at IS NOT NULL', nightId);
  const c = one(`SELECT COALESCE(SUM(CASE kind WHEN 'recarga' THEN amount WHEN 'correccion' THEN -amount END),0) recharged,
    COALESCE(SUM(CASE WHEN kind='cobro' THEN amount END),0) cashedOut FROM cash WHERE night_id = ?`, nightId);
  const house = g.bet - g.paid;
  return { night: n, hands: g.hands, bet: g.bet, paid: g.paid, house, retentionPct: g.bet ? (house / g.bet) * 100 : 0, ...c };
}

// ---------- Caja: turnos y movimientos ----------
const openShift = () => one('SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');
const cardRow = (uid) => one('SELECT uid, name, balance, machine_id FROM cards WHERE uid = ?', uid);

function cashMove(uid, kind, amount, ref = null) {
  const shift = openShift();
  if (!shift) fail(409, 'Abre un turno de caja primero');
  return run('INSERT INTO cash (night_id, shift_id, card_uid, kind, amount, ref, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    currentNight().id, shift.id, uid, kind, amount, ref, now()).lastInsertRowid;
}

function shiftReport(id) {
  const shift = one('SELECT * FROM shifts WHERE id = ?', id);
  if (!shift) return null;
  const sum = (kind) => one('SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM cash WHERE shift_id = ? AND kind = ?', id, kind);
  const r = sum('recarga'), c = sum('correccion'), o = sum('cobro');
  return { shift, recargas: r, correcciones: c, cobros: o, efectivo: r.total - c.total - o.total,
    moves: all(`SELECT x.id, x.at, x.kind, x.amount, x.card_uid, k.name FROM cash x LEFT JOIN cards k ON k.uid = x.card_uid
      WHERE x.shift_id = ? ORDER BY x.id`, id) };
}

let simCache = null;
const adminRoutes = {
  'GET /api/a/summary': () => {
    const night = currentNight();
    const machines = all(`SELECT m.id, m.name, m.card_uid, m.last_seen, c.name card_name, c.balance,
      (SELECT COUNT(*) FROM rounds r WHERE r.machine_id = m.id AND r.night_id = ?) hands,
      (SELECT COALESCE(SUM(bet - payout),0) FROM rounds r WHERE r.machine_id = m.id AND r.night_id = ? AND ended_at IS NOT NULL) house
      FROM machines m LEFT JOIN cards c ON c.uid = m.card_uid ORDER BY m.id`, night.id, night.id)
      .map((x) => ({ ...x, online: x.last_seen && Date.now() - Date.parse(x.last_seen) < 20000 }));
    return { ...nightSummary(night.id), targetPct: target(), machines };
  },
  'GET /api/a/nights': () => all('SELECT id FROM nights ORDER BY id DESC LIMIT 30').map((n) => nightSummary(n.id)),
  'POST /api/a/night/close': () => tx(() => {
    const n = currentNight();
    run('UPDATE nights SET closed_at = ? WHERE id = ?', now(), n.id);
    log('cierre-noche', nightSummary(n.id));
    try { backup(true); } catch (e) { console.error('Respaldo falló:', e.message); }
    return nightSummary(currentNight().id);
  }),
  'GET /api/a/cards': (_, q) => all(`SELECT uid, name, balance, machine_id FROM cards
    WHERE uid LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT 50`, `%${q.q || ''}%`, `%${q.q || ''}%`),
  'POST /api/a/cards': (_, { uid, name }) => tx(() => {
    uid = String(uid || '').trim();
    if (!uid) fail(400, 'Falta el número de tarjeta');
    const c = one('SELECT uid FROM cards WHERE uid = ?', uid);
    if (c) run('UPDATE cards SET name = ? WHERE uid = ?', name || null, uid);
    else { run('INSERT INTO cards (uid, name, created_at) VALUES (?, ?, ?)', uid, name || null, now()); log('tarjeta', { uid, name }); }
    return one('SELECT uid, name, balance, machine_id FROM cards WHERE uid = ?', uid);
  }),
  'POST /api/a/recharge': (_, { uid, amount }) => tx(() => {
    const cents = pesos(amount);
    if (!(cents > 0)) fail(400, 'Monto inválido');
    if (!one('SELECT 1 FROM cards WHERE uid = ?', uid)) fail(404, 'Tarjeta no registrada');
    const id = cashMove(uid, 'recarga', cents);
    run('UPDATE cards SET balance = balance + ? WHERE uid = ?', cents, uid);
    log('recarga', { id, uid, amount: cents, shift: openShift().id });
    return cardRow(uid);
  }),
  // Deshace una recarga equivocada del turno abierto, si la tarjeta aún tiene ese saldo y no está jugando.
  'POST /api/a/recharge/undo': (_, { id }) => tx(() => {
    const m = one("SELECT * FROM cash WHERE id = ? AND kind = 'recarga'", id);
    if (!m) fail(404, 'Recarga no encontrada');
    if (m.shift_id !== openShift()?.id) fail(409, 'Solo se corrigen recargas del turno abierto');
    if (one("SELECT 1 FROM cash WHERE kind = 'correccion' AND ref = ?", id)) fail(409, 'Esa recarga ya se corrigió');
    const c = cardRow(m.card_uid);
    if (c.machine_id) fail(409, 'La tarjeta está jugando en una máquina');
    if (c.balance < m.amount) fail(409, 'La tarjeta ya no tiene ese saldo: ya se jugó');
    cashMove(m.card_uid, 'correccion', m.amount, id);
    run('UPDATE cards SET balance = balance - ? WHERE uid = ?', m.amount, m.card_uid);
    log('correccion', { ref: id, uid: m.card_uid, amount: m.amount });
    return cardRow(m.card_uid);
  }),
  'POST /api/a/cashout': (_, { uid }) => tx(() => {
    const c = one('SELECT * FROM cards WHERE uid = ?', uid);
    if (!c) fail(404, 'Tarjeta no registrada');
    if (c.machine_id) fail(409, 'La tarjeta está jugando en una máquina');
    if (!c.balance) fail(400, 'La tarjeta no tiene saldo');
    cashMove(uid, 'cobro', c.balance);
    run('UPDATE cards SET balance = 0 WHERE uid = ?', uid);
    log('cobro', { uid, amount: c.balance });
    return { ...c, balance: 0, paidOut: c.balance };
  }),
  'GET /api/a/history': (_, { uid }) => {
    const cash = all(`SELECT x.id, x.at, x.kind, x.amount, x.shift_id,
      EXISTS (SELECT 1 FROM cash y WHERE y.kind = 'correccion' AND y.ref = x.id) corrected
      FROM cash x WHERE x.card_uid = ? ORDER BY x.id DESC LIMIT 30`, uid);
    const hands = all(`SELECT r.id, r.ended_at at, 'mano' kind, r.bet, r.payout, m.name machine FROM rounds r
      LEFT JOIN machines m ON m.id = r.machine_id WHERE r.card_uid = ? AND r.ended_at IS NOT NULL ORDER BY r.id DESC LIMIT 30`, uid);
    return { shiftId: openShift()?.id || null, moves: [...cash, ...hands].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40) };
  },
  'GET /api/a/shift': () => ({ current: openShift() ? shiftReport(openShift().id) : null,
    recent: all('SELECT id, cashier, opened_at, closed_at FROM shifts ORDER BY id DESC LIMIT 15') }),
  'GET /api/a/shift/report': (_, { id }) => shiftReport(Number(id)) || fail(404, 'Turno no encontrado'),
  'POST /api/a/shift/open': (_, { cashier }) => tx(() => {
    if (openShift()) fail(409, 'Ya hay un turno abierto');
    cashier = String(cashier || '').trim();
    if (!cashier) fail(400, 'Escribe el nombre del cajero');
    const id = run('INSERT INTO shifts (cashier, opened_at) VALUES (?, ?)', cashier, now()).lastInsertRowid;
    log('turno-abre', { id, cashier });
    return shiftReport(id);
  }),
  'POST /api/a/shift/close': () => tx(() => {
    const s = openShift();
    if (!s) fail(409, 'No hay turno abierto');
    run('UPDATE shifts SET closed_at = ? WHERE id = ?', now(), s.id);
    const r = shiftReport(s.id);
    log('turno-cierra', { id: s.id, cashier: s.cashier, efectivo: r.efectivo });
    return r;
  }),
  'POST /api/a/backup': () => ({ file: backup(true), dir: BACKUP_DIR }),
  'POST /api/a/machines': (_, { name }) => {
    const token = randomBytes(12).toString('hex');
    run('INSERT INTO machines (name, token) VALUES (?, ?)', String(name || 'Máquina').trim(), token);
    log('maquina', { name });
    return all('SELECT id, name, token FROM machines ORDER BY id');
  },
  'GET /api/a/machines': () => all('SELECT id, name, token FROM machines ORDER BY id'),
  'POST /api/a/machines/delete': (_, { id }) => {
    if (one('SELECT card_uid FROM machines WHERE id = ?', id)?.card_uid) fail(409, 'La máquina tiene un jugador');
    run('DELETE FROM machines WHERE id = ?', id);
    log('maquina-baja', { id });
    return all('SELECT id, name, token FROM machines ORDER BY id');
  },
  'POST /api/a/machines/release': (_, { id }) => tx(() => {
    const m = one('SELECT * FROM machines WHERE id = ?', id);
    if (!m?.card_uid) return { ok: true };
    if (openRound(m)) fail(409, 'Hay una mano a medias: enciende la máquina para terminarla');
    run('UPDATE cards SET machine_id = NULL WHERE uid = ?', m.card_uid);
    run('UPDATE machines SET card_uid = NULL WHERE id = ?', m.id);
    log('libera', { machine: m.id, card: m.card_uid });
    return { ok: true };
  }),
  'GET /api/a/settings': () => ({ rules: rules(), targetPct: target(), limits: limits() }),
  'POST /api/a/settings': (_, b) => {
    const r = rules();
    const next = {
      decks: [1, 2, 4, 6, 8].includes(+b.rules?.decks) ? +b.rules.decks : r.decks,
      bjPays: ['3:2', '6:5', '1:1'].includes(b.rules?.bjPays) ? b.rules.bjPays : r.bjPays,
      dealerHitsSoft17: typeof b.rules?.dealerHitsSoft17 === 'boolean' ? b.rules.dealerHitsSoft17 : r.dealerHitsSoft17,
      winCommissionPct: Math.min(50, Math.max(0, Number(b.rules?.winCommissionPct ?? r.winCommissionPct))),
    };
    setSetting('rules', next);
    if (b.targetPct != null) setSetting('targetPct', Math.min(50, Math.max(0, Number(b.targetPct))));
    if (b.limits) setSetting('limits', { minBet: pesos(b.limits.minBet), maxBet: pesos(b.limits.maxBet) });
    if (b.adminPin) setSetting('adminPin', String(b.adminPin));
    log('reglas', { rules: next, targetPct: target(), limits: limits() });
    simCache = null;
    return adminRoutes['GET /api/a/settings']();
  },
  'POST /api/a/simulate': () => simCache || (simCache = new Promise((ok, ko) => {
    const w = new Worker(new URL('./sim-worker.js', import.meta.url), { workerData: { rules: rules(), targetPct: target() } });
    w.once('message', ok); w.once('error', ko);
  }).catch((e) => { simCache = null; throw e; })),
  'GET /api/a/log': () => all('SELECT id, at, type, data, hash FROM log ORDER BY id DESC LIMIT 200'),
  'GET /api/a/verify': () => verifyLog(),
};

// Las claves nunca viajan por la red: cada petición va firmada con HMAC-SHA256(clave, hora + ruta + cuerpo).
// Una firma vieja (más de 5 min) o repetida se rechaza, así que copiar el tráfico del wifi no sirve.
const seen = new Map();
function signed(req, url, raw, secret) {
  const ts = Number(req.headers['x-bj-ts']), sig = String(req.headers['x-bj-sig'] || '');
  if (!(Math.abs(Date.now() - ts) < 300000)) throw Object.assign(new HttpError(409, 'Reloj desincronizado'), { clock: true });
  if (seen.has(sig)) return false;
  const good = createHmac('sha256', secret).update(`${ts}\n${req.method}\n${url.pathname}${url.search}\n${raw}`).digest('hex');
  if (sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
  seen.set(sig, Date.now());
  if (seen.size > 5000) for (const [k, t] of seen) if (Date.now() - t > 300000) seen.delete(k);
  return true;
}

// El admin solo responde en la propia PC del servidor, salvo que se active BJ_REMOTE_ADMIN=1.
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

// Tras 5 PIN incorrectos desde una IP, se bloquea 5 minutos.
const pinFails = new Map();
function checkPin(req, url, raw) {
  const ip = req.socket.remoteAddress, f = pinFails.get(ip);
  if (!isLocal(req) && process.env.BJ_REMOTE_ADMIN !== '1') fail(403, 'El admin solo funciona en la PC del servidor');
  if (f?.until > Date.now()) fail(429, 'Demasiados intentos. Espera 5 minutos.');
  if (req.headers['x-bj-key'] === 'admin' && signed(req, url, raw, String(ADMIN_PIN()))) return pinFails.delete(ip);
  const n = (f?.n || 0) + 1;
  pinFails.set(ip, { n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 300000 : 0 });
  fail(401, 'PIN incorrecto');
}

// ---------- HTTP ----------
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-bj-key, x-bj-ts, x-bj-sig',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Expose-Headers': 'x-bj-clock' };

createServer(async (req, res) => {
  const send = (status, body, extra = {}) => { res.writeHead(status, { ...CORS, ...extra, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'OPTIONS') return send(204, {});
  try {
    const url = new URL(req.url, 'http://x');
    const key = `${req.method} ${url.pathname}`;
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 1e5) fail(413, 'Muy grande'); }
    const body = raw ? JSON.parse(raw) : {};
    if (key === 'GET /api/ping') return send(200, { ok: true, time: Date.now() });
    if (machineRoutes[key]) return send(200, await machineRoutes[key](machineOf(req, url, raw), body));
    if (adminRoutes[key]) {
      checkPin(req, url, raw);
      return send(200, await adminRoutes[key](null, req.method === 'GET' ? Object.fromEntries(url.searchParams) : body));
    }
    fail(404, 'No encontrado');
  } catch (e) {
    if (!e.status) console.error(e);
    send(e.status || 400, { error: e.message }, e.clock ? { 'x-bj-clock': '1' } : {});
  }
}).listen(PORT, '0.0.0.0', () => {
  currentNight();
  const daily = () => { try { const f = backup(); if (f) console.log('Respaldo guardado:', f); } catch (e) { console.error('Respaldo falló:', e.message); } };
  daily();
  setInterval(daily, 3600000);
  console.log(`21 Blackjack servidor listo en el puerto ${PORT}`);
});
