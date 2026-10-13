// Motor del 21. Puro y determinista: el mismo seed produce las mismas cartas,
// así cualquier mano se puede reproducir y auditar desde la bitácora.
import { createHash, createHmac, randomBytes } from 'node:crypto';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

export const newSeed = () => randomBytes(32).toString('hex');
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// Barajado Fisher-Yates con un flujo HMAC-SHA256(seed) y muestreo por rechazo (sin sesgo).
export function shoe(seed, decks) {
  const cards = Array.from({ length: 52 * decks }, (_, i) => i);
  let block = Buffer.alloc(0), counter = 0, off = 0;
  const u32 = () => {
    if (off + 4 > block.length) {
      block = createHmac('sha256', seed).update(String(counter++)).digest();
      off = 0;
    }
    const v = block.readUInt32BE(off); off += 4; return v;
  };
  for (let i = cards.length - 1; i > 0; i--) {
    const n = i + 1, limit = Math.floor(0x100000000 / n) * n;
    let r; do r = u32(); while (r >= limit);
    const j = r % n;
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

const rank = (c) => c % 13;
const points = (c) => Math.min(rank(c) + 1, 10);
export const cardView = (c) => ({ r: RANKS[rank(c)], s: SUITS[Math.floor(c / 13) % 4] });

export function total(cards) {
  let t = 0, aces = 0;
  for (const c of cards) { t += points(c); if (rank(c) === 0) aces++; }
  const soft = aces > 0 && t + 10 <= 21;
  return { total: soft ? t + 10 : t, soft };
}
const isBJ = (h) => h.cards.length === 2 && !h.split && total(h.cards).total === 21;

// Reglas por defecto: las cambia el admin, son iguales para todas las máquinas y jugadores.
export const DEFAULT_RULES = { decks: 8, bjPays: '6:5', dealerHitsSoft17: true, winCommissionPct: 40 };
export const DEFAULT_TARGET_PCT = 20;

// El zapato se recalcula del seed; se guarda en caché para no rebarajar en cada carta.
const cache = new Map();
function deckOf(st) {
  let d = cache.get(st.seed);
  if (!d) {
    d = shoe(st.seed, st.rules.decks);
    cache.set(st.seed, d);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
  }
  return d;
}
// Solo para el simulador: usa un zapato ya barajado sin pasar por HMAC.
export const preloadDeck = (seed, deck) => cache.set(seed, deck);
const draw = (st) => deckOf(st)[st.pos++];

export function startRound(rules, bet, seed = newSeed()) {
  const st = { seed, seedHash: sha256(seed), rules, pos: 0, dealer: [], hands: [], active: 0, phase: 'player' };
  const deck = deckOf(st);
  const h = { cards: [deck[0], deck[2]], bet, done: false };
  st.dealer = [deck[1], deck[3]];
  st.pos = 4;
  st.hands.push(h);
  if (isBJ(h) || total(st.dealer).total === 21) return settle(st);
  return st;
}

export function options(st) {
  const h = st.hands[st.active];
  if (st.phase !== 'player' || !h) return { hit: false, stand: false, double: false, split: false };
  const two = h.cards.length === 2;
  return {
    hit: true, stand: true,
    double: two,
    split: two && st.hands.length === 1 && points(h.cards[0]) === points(h.cards[1]),
  };
}

// Devuelve { st, extraBet }: extraBet es lo que hay que cobrar del saldo (doblar / dividir).
export function act(st, action) {
  const opts = options(st);
  if (!opts[action]) throw new Error('Jugada no permitida');
  const h = st.hands[st.active];
  let extraBet = 0;
  if (action === 'hit') {
    h.cards.push(draw(st));
    if (total(h.cards).total >= 21) h.done = true;
  } else if (action === 'stand') {
    h.done = true;
  } else if (action === 'double') {
    extraBet = h.bet; h.bet *= 2; h.doubled = true;
    h.cards.push(draw(st)); h.done = true;
  } else if (action === 'split') {
    extraBet = h.bet;
    const aces = rank(h.cards[0]) === 0;
    const b = { cards: [h.cards.pop()], bet: h.bet, split: true, done: false };
    h.split = true;
    h.cards.push(draw(st)); b.cards.push(draw(st));
    st.hands.push(b);
    for (const x of st.hands) if (aces || total(x.cards).total === 21) x.done = true;
  }
  while (st.hands[st.active]?.done) st.active++;
  if (st.active >= st.hands.length) settle(st);
  return { st, extraBet };
}

function settle(st) {
  st.phase = 'done';
  const r = st.rules;
  const live = st.hands.some((h) => total(h.cards).total <= 21 && !isBJ(h));
  const dealerBJ = total(st.dealer).total === 21 && st.dealer.length === 2;
  if (live && !dealerBJ) {
    for (;;) {
      const { total: t, soft } = total(st.dealer);
      if (t < 17 || (t === 17 && soft && r.dealerHitsSoft17)) st.dealer.push(draw(st)); else break;
    }
  }
  const d = total(st.dealer).total;
  const [num, den] = r.bjPays.split(':').map(Number);
  for (const h of st.hands) {
    const p = total(h.cards).total;
    let win; // ganancia neta antes de comisión, o -1 = pierde, 0 = empate
    if (isBJ(h)) win = dealerBJ ? 0 : (h.bet * num) / den;
    else if (dealerBJ || p > 21) win = -1;
    else if (d > 21 || p > d) win = h.bet;
    else if (p === d) win = 0;
    else win = -1;
    h.result = win < 0 ? 'pierde' : win === 0 ? 'empate' : isBJ(h) ? 'blackjack' : 'gana';
    const net = win > 0 ? Math.floor(win * (1 - r.winCommissionPct / 100)) : 0;
    h.payout = win < 0 ? 0 : h.bet + net; // lo que regresa al saldo
    h.done = true;
  }
  st.active = st.hands.length;
  return st;
}

// Lo que ve la máquina: la carta oculta del crupier no viaja hasta que termina la mano.
export function view(st) {
  const playing = st.phase === 'player';
  const dealer = playing ? [st.dealer[0]] : st.dealer;
  return {
    phase: st.phase,
    seedHash: st.seedHash,
    seed: playing ? undefined : st.seed,
    dealer: { cards: dealer.map(cardView), hidden: playing, total: total(dealer).total },
    hands: st.hands.map((h) => ({
      cards: h.cards.map(cardView), total: total(h.cards).total, soft: total(h.cards).soft,
      bet: h.bet, result: h.result, payout: h.payout,
    })),
    active: st.active,
    options: options(st),
  };
}
