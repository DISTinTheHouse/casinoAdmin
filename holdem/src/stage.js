import { useEffect, useRef, useState } from 'react';

// Ritmo de la mesa. El servidor contesta al instante con la mano ya resuelta; aquí se muestra
// como en un casino: una carta a la vez, una pausa entre el flop, el turn y el river, el crupier
// voltea sus cartas y al final el resultado. Solo cambia lo que se ve, no las cartas ni los pagos.
export const PACE = {
  card: 650,      // entre cada carta del reparto inicial
  street: 1300,   // pausa antes del flop, del turn y del river
  flop: 500,      // entre las 3 cartas del flop
  reveal: 1500,   // pausa antes de que el crupier muestre
  flip: 800,      // entre las 2 cartas del crupier
  hand: 1000,     // antes de nombrar la mano del crupier
  result: 1200,   // antes del letrero del resultado
  rest: 1800,     // el resultado queda solo en pantalla antes de volver a apostar
};

const EMPTY = { p: 0, d: 0, b: 0, flip: 0, dealerHand: false, result: false, caption: '', busy: false };
const keyOf = (r) => (r ? `${r.seedHash}|${r.phase}|${r.street}|${r.board.length}` : '');
const full = (r) => ({ seedHash: r.seedHash, shown: keyOf(r), p: r.player.cards.length, d: 2, b: r.board.length, flip: r.phase === 'done' ? 2 : 0,
  dealerHand: r.phase === 'done', result: r.phase === 'done', caption: '', busy: false });
const STREETS = { 1: 'El flop', 4: 'El turn', 5: 'El river' };

function plan(cur, r) {
  const steps = []; // [espera antes, cambios, sonido]
  const s = { ...cur };
  if (s.p < r.player.cards.length) {
    steps.push([0, { ...EMPTY, busy: true, caption: 'Repartiendo' }]);
    for (const k of ['p', 'd', 'p', 'd']) steps.push([PACE.card, { [k]: ++s[k] }, 'deal']);
  } else steps.push([0, { busy: true }]);
  for (let b = s.b + 1; b <= r.board.length; b++) {
    const street = STREETS[b];
    steps.push([street ? PACE.street : PACE.flop, { b, ...(street && { caption: street }) }, 'deal']);
  }
  if (r.phase === 'done') {
    steps.push([PACE.reveal, { caption: 'El crupier muestra sus cartas' }]);
    steps.push([PACE.flip, { flip: 1 }, 'flip'], [PACE.flip, { flip: 2 }, 'flip']);
    steps.push([PACE.hand, { dealerHand: true }]);
    steps.push([PACE.result, { result: true, caption: '' }, 'result']);
    steps.push([PACE.rest, { busy: false, shown: keyOf(r) }]);
  } else steps.push([PACE.card, { busy: false, caption: '', shown: keyOf(r) }]);
  return steps;
}

export default function useStaged(round, ready, onSound) {
  const [stage, setStage] = useState(EMPTY);
  const cur = useRef(EMPTY);
  const timers = useRef([]);
  const seen = useRef(false);
  const sound = useRef(onSound);
  sound.current = onSound;
  const key = keyOf(round);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const set = (s) => { cur.current = s; setStage(s); };
    if (!ready) return;
    // Al abrir la mesa con una mano a medias (por ejemplo, tras reiniciar) se muestra tal cual, sin repetirla.
    if (!seen.current || !round) { seen.current = true; set(round ? full(round) : EMPTY); return; }
    if (cur.current.shown === key) return;
    const fresh = cur.current.seedHash !== round.seedHash;
    let at = 0;
    for (const [wait, patch, sfx] of plan(fresh ? EMPTY : cur.current, round)) {
      at += wait;
      timers.current.push(setTimeout(() => { set({ ...cur.current, ...patch, seedHash: round.seedHash }); if (sfx) sound.current(sfx); }, at));
    }
    return () => timers.current.forEach(clearTimeout);
  }, [key, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mientras llega el siguiente paso, nada nuevo se asoma: ni las cartas de otra mano ni los botones.
  if (!round || stage.shown === key) return stage;
  return stage.seedHash === round.seedHash ? { ...stage, busy: true } : { ...EMPTY, busy: true, caption: 'Repartiendo' };
}
