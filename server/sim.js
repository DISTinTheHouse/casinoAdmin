// Simulador: juega muchas manos con las reglas actuales y mide la retención esperada.
import { startRound, act, options, total, preloadDeck } from './engine.js';

function quickDeck(decks) {
  const d = Array.from({ length: 52 * decks }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

const up = (st) => Math.min((st.dealer[0] % 13) + 1, 10); // 1 = As
const pts = (c) => Math.min((c % 13) + 1, 10);

// Estrategia básica simplificada (jugador que sabe jugar).
function basic(st) {
  const h = st.hands[st.active], o = options(st), d = up(st) === 1 ? 11 : up(st);
  const { total: t, soft } = total(h.cards);
  if (o.split && (pts(h.cards[0]) === 1 || pts(h.cards[0]) === 8)) return 'split';
  if (soft) {
    if (o.double && (t === 17 || t === 18) && d >= 3 && d <= 6) return 'double';
    if (t >= 19 || (t === 18 && d <= 8)) return 'stand';
    return 'hit';
  }
  if (o.double && (t === 11 || (t === 10 && d <= 9) || (t === 9 && d >= 3 && d <= 6))) return 'double';
  if (t >= 17) return 'stand';
  if (t >= 13 && d <= 6) return 'stand';
  if (t === 12 && d >= 4 && d <= 6) return 'stand';
  return 'hit';
}
// Jugador casual: pide hasta 17, como el crupier.
const casual = (st) => (total(st.hands[st.active].cards).total < 17 ? 'hit' : 'stand');

export function simulate(rules, hands = 100000) {
  const out = {};
  for (const [name, strat] of Object.entries({ basica: basic, casual })) {
    let handle = 0, paid = 0, grossWins = 0;
    const r0 = { ...rules, winCommissionPct: 0 };
    for (let i = 0; i < hands; i++) {
      const seed = 'sim' + i;
      preloadDeck(seed, quickDeck(rules.decks));
      let st = startRound(r0, 100, seed);
      while (st.phase === 'player') st = act(st, strat(st)).st;
      for (const h of st.hands) {
        handle += h.bet; paid += h.payout;
        if (h.payout > h.bet) grossWins += h.payout - h.bet;
      }
    }
    // La comisión es lineal: retención(c) = ventaja_reglas + c * ganancias/apostado.
    const edge = (handle - paid) / handle, w = grossWins / handle;
    out[name] = {
      ventajaReglasPct: +(edge * 100).toFixed(2),
      retencionPct: +((edge + (w * rules.winCommissionPct) / 100) * 100).toFixed(2),
      comisionParaMeta: (target) => +Math.max(0, ((target / 100 - edge) / w) * 100).toFixed(1),
    };
  }
  return out;
}
