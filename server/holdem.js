// Motor de Texas Hold'em contra la casa (reglas tipo Ultimate Texas Hold'em).
// Puro y determinista como el del 21: el seed reproduce la baraja y la mano completa.
import { shoe, newSeed, sha256, cardView } from './engine.js';

// Ciega: paga solo si el jugador gana con escalera o mejor (si no, empata).
export const BLIND_PAYS = { 9: 500, 8: 50, 7: 10, 6: 3, 5: 1.5, 4: 1 };
export const NAMES = ['Carta alta', 'Par', 'Dos pares', 'Tercia', 'Escalera', 'Color', 'Full', 'Póker', 'Escalera de color', 'Escalera real'];
export const DEFAULT_HOLDEM = { winCommissionPct: 40 };

const value = (c) => (c % 13 === 0 ? 14 : (c % 13) + 1); // 2..14, As = 14
const suit = (c) => Math.floor(c / 13) % 4;

function straightHigh(vals) {
  const s = new Set(vals);
  if (s.has(14)) s.add(1);
  for (let h = 14; h >= 5; h--) if ([0, 1, 2, 3, 4].every((i) => s.has(h - i))) return h;
  return 0;
}

// Mejor juego de 5 con las cartas dadas. Devuelve [categoría, ...desempates]; se compara en orden.
export function best(cards) {
  const vals = cards.map(value).sort((a, b) => b - a);
  const suits = [0, 1, 2, 3].map((s) => cards.filter((c) => suit(c) === s).map(value).sort((a, b) => b - a));
  const flush = suits.find((s) => s.length >= 5);
  if (flush) { const sf = straightHigh(flush); if (sf) return [sf === 14 ? 9 : 8, sf]; }
  const count = {};
  for (const v of vals) count[v] = (count[v] || 0) + 1;
  const groups = Object.entries(count).map(([v, n]) => [n, +v]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const kick = (n, ...skip) => vals.filter((v) => !skip.includes(v)).slice(0, n);
  const [g1, g2] = groups;
  if (g1[0] === 4) return [7, g1[1], ...kick(1, g1[1])];
  if (g1[0] === 3 && g2?.[0] >= 2) return [6, g1[1], g2[1]];
  if (flush) return [5, ...flush.slice(0, 5)];
  const st = straightHigh(vals);
  if (st) return [4, st];
  if (g1[0] === 3) return [3, g1[1], ...kick(2, g1[1])];
  if (g1[0] === 2 && g2?.[0] === 2) return [2, g1[1], g2[1], ...kick(1, g1[1], g2[1])];
  if (g1[0] === 2) return [1, g1[1], ...kick(3, g1[1])];
  return [0, ...vals.slice(0, 5)];
}
export function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  return 0;
}

// Reparto: jugador 0-1, crupier 2-3, mesa 4-8. Ante y Ciega son iguales y se cobran al repartir.
export function startRound(rules, ante, seed = newSeed(), deck = shoe(seed, 1)) {
  return { game: 'holdem', seed, seedHash: sha256(seed), rules, ante, blind: ante, play: 0, street: 0, phase: 'player',
    player: deck.slice(0, 2), dealer: deck.slice(2, 4), board: deck.slice(4, 9) };
}

// Antes del flop: apostar 4x o 3x. En el flop: 2x. Al final: 1x o retirarse. Pasar sigue a la siguiente calle.
export function options(st) {
  const p = st.phase === 'player', s = st.street;
  return { bet4: p && s === 0, bet3: p && s === 0, bet2: p && s === 1, bet1: p && s === 2, check: p && s < 2, fold: p && s === 2 };
}

// Devuelve { st, extraBet }: extraBet es la apuesta de Juego que hay que cobrar del saldo.
export function act(st, action) {
  if (!options(st)[action]) throw new Error('Jugada no permitida');
  if (action === 'check') { st.street++; return { st, extraBet: 0 }; }
  if (action === 'fold') { st.folded = true; settle(st); return { st, extraBet: 0 }; }
  st.play = st.ante * Number(action.slice(3));
  settle(st);
  return { st, extraBet: st.play };
}

function settle(st) {
  st.phase = 'done'; st.street = 3;
  const ph = best([...st.player, ...st.board]), dh = best([...st.dealer, ...st.board]);
  const qualifies = dh[0] >= 1; // el crupier califica con par o mejor
  const total = st.ante + st.blind + st.play;
  let payout, result;
  if (st.folded) { payout = 0; result = 'retira'; }
  else {
    const c = compare(ph, dh);
    if (c > 0) {
      result = 'gana';
      payout = st.play * 2 + (qualifies ? st.ante * 2 : st.ante) + st.blind + Math.floor(st.blind * (BLIND_PAYS[ph[0]] || 0));
    } else if (c === 0) { result = 'empate'; payout = total; }
    else { result = 'pierde'; payout = qualifies ? 0 : st.ante; }
  }
  const win = payout - total;
  if (win > 0) payout -= Math.floor(win * st.rules.winCommissionPct / 100);
  Object.assign(st, { payout, result, qualifies, playerHand: ph[0], dealerHand: dh[0] });
  return st;
}

export const totals = (st) => ({ bet: st.ante + st.blind + st.play, payout: st.payout });

// Lo que ve la máquina: las cartas del crupier y las de la mesa que faltan no viajan hasta su momento.
export function view(st) {
  const done = st.phase === 'done', shown = [0, 3, 5, 5][st.street];
  const board = st.board.slice(0, shown);
  return {
    game: 'holdem', phase: st.phase, street: st.street, seedHash: st.seedHash, seed: done ? st.seed : undefined,
    ante: st.ante, blind: st.blind, play: st.play,
    player: { cards: st.player.map(cardView), hand: NAMES[best([...st.player, ...board])[0]] },
    dealer: { cards: done ? st.dealer.map(cardView) : [], hidden: !done, hand: done ? NAMES[st.dealerHand] : null, qualifies: st.qualifies },
    board: board.map(cardView),
    result: st.result, payout: st.payout, options: options(st),
  };
}
