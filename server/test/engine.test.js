// node --test : comprueba reglas básicas y que el seed reproduce la mano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRound, act, shoe, total, DEFAULT_RULES } from '../engine.js';

const card = (rank, suit = 0) => suit * 13 + rank; // rank 0 = As, 9..12 = 10/J/Q/K

test('totales con As', () => {
  assert.deepEqual(total([card(0), card(9)]), { total: 21, soft: true });
  assert.deepEqual(total([card(0), card(0), card(8)]), { total: 21, soft: true });
  assert.deepEqual(total([card(0), card(5), card(9)]), { total: 17, soft: false });
});

test('el mismo seed da el mismo zapato y es una permutación completa', () => {
  const a = shoe('abc', 6), b = shoe('abc', 6);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 312);
});

test('una mano siempre termina y nunca paga de más', () => {
  for (let i = 0; i < 2000; i++) {
    let st = startRound(DEFAULT_RULES, 1000);
    while (st.phase === 'player') st = act(st, Math.random() < 0.5 ? 'hit' : 'stand').st;
    for (const h of st.hands) assert.ok(h.payout >= 0 && h.payout <= h.bet * 2.5);
  }
});

test('no se puede doblar con tres cartas', () => {
  let st = startRound(DEFAULT_RULES, 1000, 'seed-fijo');
  while (st.phase === 'player' && st.hands[0].cards.length < 3) st = act(st, 'hit').st;
  if (st.phase === 'player') assert.throws(() => act(st, 'double'));
});
