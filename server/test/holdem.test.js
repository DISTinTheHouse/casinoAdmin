// node --test : comprueba el Hold'em contra la casa (juegos, pagos y que el seed reproduce la mano).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { best, compare, startRound, act, view, DEFAULT_HOLDEM } from '../holdem.js';

// Carta por texto: 'As' = As de picas, 'Th' = 10 de corazones. Palos: s h d c.
const c = (t) => 'shdc'.indexOf(t[1]) * 13 + ('A23456789TJQK'.indexOf(t[0]));
const cards = (s) => s.split(' ').map(c);
const rules = { winCommissionPct: 0 };
// Mano armada: jugador, crupier y las 5 de la mesa.
const deck = (p, d, b) => [...cards(p), ...cards(d), ...cards(b), ...Array(43).fill(0)];

test('reconoce los juegos de 7 cartas', () => {
  assert.equal(best(cards('As Ks Qs Js Ts 2h 3d'))[0], 9);
  assert.equal(best(cards('9h 8h 7h 6h 5h Ah Kd'))[0], 8);
  assert.equal(best(cards('7s 7h 7d 7c 2s 3h 4d'))[0], 7);
  assert.equal(best(cards('Ks Kh Kd 2c 2s 3h 3d'))[0], 6);
  assert.equal(best(cards('As 9s 7s 4s 2s Kh Kd'))[0], 5);
  assert.deepEqual(best(cards('As 2h 3d 4c 5s Kh Qd')), [4, 5]); // escalera baja con As
  assert.equal(best(cards('Qs Qh Qd 9c 2s 3h 5d'))[0], 3);
  assert.deepEqual(best(cards('As Ah Ks Kh Qs Qh 2d')), [2, 14, 13, 12]);
  assert.equal(best(cards('Js Jh 2d 5c 8s 9h Kd'))[0], 1);
  assert.equal(best(cards('As Jh 2d 5c 8s 9h Kd'))[0], 0);
  assert.ok(compare(best(cards('As Ah Kd 7c 5s 3h 2d')), best(cards('As Ah Qd 7c 5s 3h 2d'))) > 0); // gana el kicker
});

test('el jugador gana: Juego 1:1, Ante 1:1 y la Ciega paga con escalera', () => {
  let st = startRound(rules, 100, 's', deck('9h 8d', 'Ac 2c', '7s 6c 5d Kh 3s')); // escalera al 9 vs As alto
  st = act(st, 'bet4').st;
  assert.equal(st.result, 'gana');
  assert.equal(st.qualifies, false); // crupier sin par: el Ante empata
  assert.equal(st.payout, 400 * 2 + 100 + 100 + 100);
});

test('el jugador pierde todo si el crupier califica; si no, recupera el Ante', () => {
  let st = act(startRound(rules, 100, 's', deck('2h 3d', 'Ac Ad', '7s 9c Jd Kh 4s')), 'check').st;
  st = act(act(st, 'check').st, 'bet1').st;
  assert.equal(st.result, 'pierde');
  assert.equal(st.payout, 0);
  st = act(act(act(startRound(rules, 100, 's', deck('2h 3d', 'Ac 8d', '7s 9c Jd Kh 4s')), 'check').st, 'check').st, 'bet1').st;
  assert.equal(st.result, 'pierde');
  assert.equal(st.payout, 100);
});

test('retirarse pierde Ante y Ciega; la comisión solo se cobra de lo ganado', () => {
  let st = act(act(startRound(rules, 100, 's', deck('2h 3d', 'Ac Ad', '7s 9c Jd Kh 4s')), 'check').st, 'check').st;
  assert.throws(() => act(st, 'bet4'));
  assert.equal(act(st, 'fold').st.payout, 0);
  st = act(startRound(DEFAULT_HOLDEM, 100, 's', deck('Ah Ad', '2c 3d', '7s 9c Jd Kh 4s')), 'bet4').st;
  const gross = 400 * 2 + 100 + 100; // Juego paga 1:1; Ante y Ciega regresan (crupier sin par, par no paga Ciega)
  assert.equal(st.payout, 600 + Math.floor((gross - 600) * 0.6));
});

test('la máquina no ve las cartas del crupier ni la mesa antes de tiempo', () => {
  const st = startRound(rules, 100, 'seed-fijo');
  assert.deepEqual(startRound(rules, 100, 'seed-fijo').board, st.board);
  const v = view(st);
  assert.equal(v.board.length, 0);
  assert.equal(v.dealer.cards.length, 0);
  assert.equal(v.seed, undefined);
  assert.equal(view(act(st, 'check').st).board.length, 3);
});

test('una mano siempre termina y nunca paga de más', () => {
  for (let i = 0; i < 3000; i++) {
    let st = startRound(DEFAULT_HOLDEM, 1000);
    const moves = ['check', 'bet4', 'bet3', 'bet2', 'bet1', 'fold'];
    while (st.phase === 'player') {
      const ok = moves.filter((m) => view(st).options[m]);
      st = act(st, ok[i % ok.length]).st;
    }
    const total = st.ante + st.blind + st.play;
    assert.ok(st.payout >= 0 && st.payout <= total + 4 * 1000 + 1000 + 500 * 1000);
  }
});

test('la tabla de la Ciega y el 3× se configuran desde las reglas', () => {
  const r = { ...rules, allow3x: false, blindPays: { 9: 500, 8: 50, 7: 10, 6: 3, 5: 1.5, 4: 2 } };
  const st = startRound(r, 100, 's', deck('9h 8d', 'Ac 2c', '7s 6c 5d Kh 3s'));
  assert.equal(view(st).options.bet3, false);
  assert.equal(act(st, 'bet4').st.payout, 400 * 2 + 100 + 100 + 200); // escalera: la Ciega paga 2 a 1
});
