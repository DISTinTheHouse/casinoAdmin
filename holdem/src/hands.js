// Solo para mostrar: nombra la mano con las cartas que ya están en la mesa y marca las cartas que la forman.
// Quien gana y cuánto se paga lo decide el servidor; esto no cambia ningún resultado.
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const NAMES = ['Carta alta', 'Par', 'Dos pares', 'Tercia', 'Escalera', 'Color', 'Full', 'Póker', 'Escalera de color', 'Escalera real'];

const value = (c) => (c.r === 'A' ? 14 : RANKS.indexOf(c.r) + 1);

function straightHigh(vals) {
  const s = new Set(vals);
  if (s.has(14)) s.add(1);
  for (let h = 14; h >= 5; h--) if ([0, 1, 2, 3, 4].every((i) => s.has(h - i))) return h;
  return 0;
}

// Mismo criterio que server/holdem.js: [categoría, ...desempates].
function rank(cards) {
  const vals = cards.map(value).sort((a, b) => b - a);
  const flush = [...new Set(cards.map((c) => c.s))].map((s) => cards.filter((c) => c.s === s).map(value).sort((a, b) => b - a)).find((s) => s.length >= 5);
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
const compare = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  return 0;
};

export const handName = (cards) => (cards.length ? NAMES[rank(cards)[0]] : null);

// Posiciones (dentro de `cards`) de las cartas que forman la mano: el par, la tercia, las 5 de la escalera…
export function winningCards(cards) {
  if (cards.length < 5) return [];
  let top = null;
  const pick = (start, combo) => {
    if (combo.length === 5) {
      const r = rank(combo.map((i) => cards[i]));
      if (!top || compare(r, top.r) > 0) top = { r, combo };
      return;
    }
    for (let i = start; i < cards.length; i++) pick(i + 1, [...combo, i]);
  };
  pick(0, []);
  const cat = top.r[0], vals = top.combo.map((i) => value(cards[i]));
  if ([4, 5, 8, 9].includes(cat)) return top.combo;
  if (cat === 0) return [top.combo[vals.indexOf(Math.max(...vals))]];
  return top.combo.filter((_, k) => vals.filter((v) => v === vals[k]).length >= 2);
}
