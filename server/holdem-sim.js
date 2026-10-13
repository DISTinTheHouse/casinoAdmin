// Simulador del Hold'em: juega muchas manos con las reglas actuales y mide la retención esperada.
import { startRound, act, best } from './holdem.js';

function quickDeck() {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
const v = (c) => (c % 13 === 0 ? 14 : (c % 13) + 1);
const shown = (st) => st.board.slice(0, [0, 3, 5][st.street]);
// ¿El jugador tiene par o mejor gracias a sus propias cartas (no solo por la mesa)?
const hiddenPair = (st) => {
  const b = shown(st), mine = best([...st.player, ...b])[0];
  return mine >= 1 && mine > (b.length ? best(b)[0] : 0);
};

// Jugador que sabe jugar (estrategia simplificada conocida para este juego).
function expert(st) {
  const [a, b] = st.player.map(v).sort((x, y) => y - x), suited = Math.floor(st.player[0] / 13) === Math.floor(st.player[1] / 13);
  if (st.street === 0) return a === b && a >= 3 || a === 14 || (a === 13 && (suited || b >= 5)) || (a === 12 && (b >= 8 || (suited && b >= 6))) || (a === 11 && b >= 10) ? 'bet4' : 'check';
  if (st.street === 1) return hiddenPair(st) && !(a === b && a === 2) ? 'bet2' : 'check';
  return hiddenPair(st) ? 'bet1' : 'fold';
}
// Jugador casual: pasa hasta el final y apuesta si tiene algún par, si no se retira.
const casual = (st) => (st.street < 2 ? 'check' : best([...st.player, ...st.board])[0] >= 1 ? 'bet1' : 'fold');

export function simulate(rules, hands = 100000) {
  const out = {};
  for (const [name, strat] of Object.entries({ basica: expert, casual })) {
    let handle = 0, paid = 0, grossWins = 0;
    const r0 = { ...rules, winCommissionPct: 0 };
    for (let i = 0; i < hands; i++) {
      let st = startRound(r0, 100, 'sim' + i, quickDeck());
      while (st.phase === 'player') st = act(st, strat(st)).st;
      const bet = st.ante + st.blind + st.play;
      handle += bet; paid += st.payout;
      if (st.payout > bet) grossWins += st.payout - bet;
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
