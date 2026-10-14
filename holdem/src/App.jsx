import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getConfig, setConfig, money } from './api.js';
import useCardReader from './useCardReader.js';
import { sfx, soundOn, setSound } from './sounds.js';
import useUpdate from './update.js';
import useStaged from './stage.js';
import { Confetti, useCountUp } from './celebrate.js';
import { NAMES, handName, winningCards } from './hands.js';

const CHIPS = [1000, 5000, 10000, 50000]; // centavos: $10, $50, $100, $500
const IDLE_MS = 120000;
const PAYS = [[9, 'Escalera real'], [8, 'Escalera de color'], [7, 'Póker'], [6, 'Full'], [5, 'Color'], [4, 'Escalera']];
// 1.5 se muestra como "3 a 2"; 0 = la Ciega solo empata.
export const ratio = (x) => (Number.isInteger(x) ? `${x} a 1` : Number.isInteger(x * 2) ? `${x * 2} a 2` : `${x} a 1`);
const HINT = ['Antes del flop: apuesta 4× o 3× el Ante, o pasa', 'Flop: apuesta 2× el Ante o pasa', 'Última oportunidad: apuesta 1× el Ante o retírate'];

export default function App() {
  const [cfg, setCfg] = useState(getConfig);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);

  const call = useCallback(async (path, body) => {
    try {
      const s = await api(path, body);
      setState(s); setError(''); setOffline(false);
      return s;
    } catch (e) {
      setError(e.message);
      setTimeout(() => setError(''), 3500);
    }
  }, []);

  useEffect(() => {
    if (!cfg) return;
    call('state');
    const t = setInterval(() => api('state').then(() => setOffline(false), () => setOffline(true)), 5000); // latido para el admin
    return () => clearInterval(t);
  }, [cfg, call]);

  useCardReader((uid) => {
    if (!cfg) return;
    if (state?.card && !state.round) call('close');
    else if (!state?.card) call('open', { uid });
  });

  const update = useUpdate(cfg?.server, 'holdem');

  // La mano se muestra paso a paso (ver stage.js); los sonidos van al ritmo de lo que aparece.
  const round = state?.round?.game === 'holdem' ? state.round : null;
  const latest = useRef(round);
  const latestPays = useRef();
  latestPays.current = state?.holdem?.blindPays;
  latest.current = round;
  const stage = useStaged(round, !!state, (kind) => {
    const r = latest.current;
    if (kind !== 'result') return sfx.deal(1);
    if (!r) return;
    const bet = r.ante + r.blind + r.play;
    if (r.payout > bet && bigHand(r, latestPays.current)) { sfx.blackjack(); sfx.payout(24); }
    else if (r.payout > bet) { sfx.win(); sfx.payout(12); }
    else if (r.payout === bet) sfx.push();
    else sfx.lose();
  });

  if (!cfg) return <Setup onSave={(c) => { setConfig(c); setCfg(c); }} />;
  const other = state?.round && state.round.game !== 'holdem';
  return (
    <div className="felt">
      <Header state={state} stage={stage} onReset={() => { setConfig(null); setCfg(null); }} onExit={() => call('close')} />
      {!state ? <div className="center muted">Conectando…</div>
        : other ? <div className="center"><div className="empty">Esta tarjeta tiene una mano de 21 sin terminar. Termínala en la mesa de 21.</div></div>
        : state.card ? <Table state={state} stage={stage} call={call} />
        : <Idle update={update} onDemo={import.meta.env.DEV ? (uid) => call('open', { uid }) : null} />}
      {state && <Rules h={state.holdem} />}
      {error && <div className="toast">{error}</div>}
      {offline && <div className="offline">Sin conexión con el servidor. Reintentando…</div>}
    </div>
  );
}

function Header({ state, stage, onReset, onExit }) {
  const taps = useRef(0);
  const [sound, setS] = useState(soundOn);
  const toggle = () => { setSound(!sound); setS(!sound); };
  const exitable = !state?.round || (state.round.phase === 'done' && !stage.busy);
  const secret = () => { if (++taps.current >= 7 && confirm('¿Configurar esta máquina de nuevo?')) onReset(); };
  return (
    <header className="top">
      <div className="left">
        <div className="logo" onClick={secret}>♠<span>TEXAS HOLD'EM</span></div>
        <button className="sound" onClick={toggle} aria-label={sound ? 'Silenciar' : 'Activar sonido'}>{sound ? '🔊' : '🔇'}</button>
      </div>
      {state?.card && (
        <div className="who">
          <div className="name">{state.card.name || 'Jugador'}</div>
          {/* Lo ganado se suma al saldo hasta que aparece el resultado, no antes. */}
          <Balance value={state.round?.phase === 'done' && !stage.result ? state.card.balance - state.round.payout : state.card.balance} />
          {/* El botón guarda su lugar aunque esté oculto, para que la mesa no brinque al aparecer. */}
          <button className={'exit' + (exitable ? '' : ' away')} onClick={onExit} disabled={!exitable}>Terminar y guardar saldo</button>
        </div>
      )}
    </header>
  );
}

function Balance({ value }) {
  const [shown, up] = useCountUp(value);
  return <div className={'balance' + (up ? ' up' : '')}>{money(shown)}</div>;
}

function Idle({ onDemo, update }) {
  return (
    <div className="center idle">
      <div className="nfc"><div className="card-icon">♠</div></div>
      <h1>Acerca tu tarjeta</h1>
      <p className="muted">para empezar a jugar</p>
      {update.version && (
        <div className="update">
          {update.state === 'installing' ? 'Actualizando… la mesa se reinicia sola.'
            : <>Hay una versión nueva ({update.version}) <button className="ghost" onClick={update.install}>Actualizar ahora</button></>}
          {update.state && update.state !== 'installing' && <small>{update.state}</small>}
        </div>
      )}
      {onDemo && <button className="ghost" onClick={() => onDemo(prompt('Número de tarjeta') || '')}>Tarjeta de prueba</button>}
    </div>
  );
}

function Table({ state, stage, call }) {
  const { card, round, holdem: limits } = state;
  const [ante, setAnte] = useState(() => Math.min(limits.minBet * 5, limits.maxBet));
  const [busy, setBusy] = useState(false);
  const lastTouch = useRef(Date.now());
  const playing = round?.phase === 'player';
  const waiting = round && stage.busy;

  const go = async (path, body) => {
    if (busy) return;
    lastTouch.current = Date.now();
    setBusy(true);
    await call(path, body);
    setBusy(false);
  };

  useEffect(() => {
    const t = setInterval(() => {
      if (!playing && Date.now() - lastTouch.current > IDLE_MS) call('close');
    }, 5000);
    return () => clearInterval(t);
  }, [playing, call]);

  const add = (c) => { sfx.chip(); lastTouch.current = Date.now(); setAnte((b) => Math.min(b + c, limits.maxBet, Math.floor(card.balance / 3))); };
  const canDeal = ante >= limits.minBet && ante * 3 <= card.balance;
  const bet = (x) => go('holdem/action', { action: `bet${x}` });
  const can = (x) => !busy && card.balance >= round.ante * x;
  const shown = round || { ante, blind: ante, play: 0 };

  // Solo las cartas que ya se repartieron en pantalla.
  const mine = round?.player.cards.slice(0, stage.p) || [];
  const board = round?.board.slice(0, stage.b) || [];
  const dealer = round?.dealer.cards.slice(0, stage.flip) || [];
  const myHand = mine.length === 2 ? (stage.result ? round.player.hand : handName([...mine, ...board])) : null;
  // Al final se marcan las cartas que forman la mano ganadora y el resto se oscurece.
  // Con carta alta no se marca nada: casi siempre la decide una carta que comparten los dos.
  const winner = stage.result && round.result !== 'retira' ? (round.result === 'pierde' ? 'dealer' : 'player') : null;
  const bet0 = round ? round.ante + round.blind + round.play : 0;
  const won = stage.result && round.payout > bet0;
  const bigWin = won && bigHand(round, limits.blindPays);
  const marks = winner && (winner === 'dealer' ? round.dealer.hand : round.player.hand) !== 'Carta alta' ? winningCards([...(winner === 'dealer' ? dealer : mine), ...board]) : null;
  const hole = marks && marks.filter((i) => i < 2);
  const onBoard = marks && marks.filter((i) => i >= 2).map((i) => i - 2);

  return (
    <main className="table poker">
      <section className="seat dealer">
        <div className={'label' + (winner === 'dealer' ? ' winner' : '')}><span>Crupier</span>{stage.dealerHand && <b className="pop">{round.dealer.hand}</b>}
          {stage.dealerHand && round.result !== 'retira' && !round.dealer.qualifies && <em className="pop">No califica: tu Ante regresa</em>}</div>
        <Hand cards={dealer} backs={round ? stage.d - dealer.length : 0} empty={2} win={winner === 'dealer' ? hole : null} />
      </section>

      <section className="board">
        <Hand cards={board} empty={5} spread win={onBoard} />
        <div className="banner-slot">
          {stage.result ? <Result round={round} pays={limits.blindPays} />
            : stage.caption && <div key={stage.caption} className="street">{stage.caption}</div>}
        </div>
      </section>

      <section className="seat player">
        <div className="hand-box">
          <Hand cards={mine} empty={2} win={winner === 'player' ? hole : null} />
          <div className={'label' + (winner === 'player' ? ' winner' : '')}><span>Tú</span>{myHand && <b key={myHand} className="pop">{myHand}</b>}</div>
        </div>
        <div className="spots">
          <Spot label="Ante" value={shown.ante} />
          <Spot label="Ciega" value={shown.blind} />
          <Spot label="Juego" value={shown.play} gold />
        </div>
      </section>

      <footer className="controls">
        {waiting ? (
          <p className="hint wait">{stage.result ? 'Mira el resultado' : 'Mira las cartas'}<i>.</i><i>.</i><i>.</i></p>
        ) : playing ? (
          <div>
            <p className="hint">{round.street === 0 && !round.options.bet3 ? 'Antes del flop: apuesta 4× el Ante o pasa' : HINT[round.street]}</p>
            <div className="actions">
              {round.options.bet4 && <Btn icon="4×" label={`Apostar ${money(round.ante * 4)}`} kind="double" onClick={() => bet(4)} disabled={!can(4)} />}
              {round.options.bet3 && <Btn icon="3×" label={`Apostar ${money(round.ante * 3)}`} kind="double" onClick={() => bet(3)} disabled={!can(3)} />}
              {round.options.bet2 && <Btn icon="2×" label={`Apostar ${money(round.ante * 2)}`} kind="double" onClick={() => bet(2)} disabled={!can(2)} />}
              {round.options.bet1 && <Btn icon="1×" label={`Apostar ${money(round.ante)}`} kind="double" onClick={() => bet(1)} disabled={!can(1)} />}
              {round.options.check && <Btn icon="✓" label="Pasar" kind="hit" onClick={() => go('holdem/action', { action: 'check' })} disabled={busy} />}
              {round.options.fold && <Btn icon="✕" label="Retirarse" kind="stand" onClick={() => go('holdem/action', { action: 'fold' })} disabled={busy} />}
            </div>
          </div>
        ) : card.balance < limits.minBet * 3 ? (
          <div className="empty">Saldo insuficiente. Recarga en caja para seguir jugando.</div>
        ) : (
          <div className="betting">
            <div className="chips">
              {CHIPS.filter((c) => c <= limits.maxBet).map((c) => (
                <button key={c} className={`chip c${c}`} onClick={() => add(c)} disabled={card.balance < c * 3}>{money(c)}</button>
              ))}
            </div>
            <div className="bet">
              <small>Ante + Ciega</small>{money(ante * 2)}
              <button className="clear" onClick={() => setAnte(0)}>Borrar</button>
            </div>
            <button className="deal" disabled={!canDeal || busy} onClick={() => go('holdem/deal', { ante })}>Repartir</button>
          </div>
        )}
      </footer>
      <PayTable pays={state.holdem.blindPays} />
      {won && <><div key={'f' + round.seedHash} className={'win-flash' + (bigWin ? ' big' : '')} /><Confetti key={round.seedHash} big={bigWin} /></>}
    </main>
  );
}

// Premio grande = la Ciega paga (escalera o mejor): más confeti y otro sonido.
const bigHand = (r, pays) => r.result === 'gana' && !!pays?.[NAMES.indexOf(r.player.hand)];

function Result({ round, pays }) {
  const bet = round.ante + round.blind + round.play;
  const blind = round.result === 'gana' && pays[NAMES.indexOf(round.player.hand)];
  const [text, kind] = round.result === 'retira' ? ['Te retiraste', 'lose']
    : round.payout > bet ? [`${blind ? '¡Gran premio!' : '¡Ganaste!'} +${money(round.payout - bet)}`, 'win']
    : round.payout === bet ? ['Empate', 'push']
    : round.payout > 0 ? [`Gana la casa · regresan ${money(round.payout)}`, 'lose'] : ['Gana la casa', 'lose'];
  return (
    <div className="result">
      <div className={`banner ${kind}`}>{text}</div>
      {round.result !== 'retira' && (
        <div className="versus">Tú: <b>{round.player.hand}</b> · Crupier: <b>{round.dealer.hand}</b>
          {blind ? <> · La Ciega paga <b>{ratio(blind)}</b></> : null}</div>
      )}
    </div>
  );
}

const Spot = ({ label, value, gold }) => (
  <div className={'spot' + (value ? ' on' : '') + (gold ? ' gold' : '')}><small>{label}</small>{value ? money(value) : '—'}</div>
);

// `backs` = cartas boca abajo; al voltearse ocupan el mismo lugar y se animan como un giro.
function Hand({ cards = [], backs = 0, empty, spread, win }) {
  const slots = Math.max(0, empty - cards.length - backs);
  return (
    <div className={'hand' + (spread ? ' spread' : '')}>
      {cards.map((c, i) => <Card key={i} c={c} mark={win ? (win.includes(i) ? ' win' : ' dim') : ''} />)}
      {Array.from({ length: backs }, (_, i) => <div key={cards.length + i} className="card back" />)}
      {Array.from({ length: slots }, (_, i) => <div key={'s' + i} className="card slot" />)}
    </div>
  );
}

function Card({ c, mark }) {
  const red = c.s === '♥' || c.s === '♦';
  return (
    <div className={'card face' + (red ? ' red' : '') + mark}>
      <span className="corner">{c.r}<br />{c.s}</span>
      <span className="pip">{c.s}</span>
      <span className="corner br">{c.r}<br />{c.s}</span>
    </div>
  );
}

function Btn({ icon, label, kind, ...p }) {
  return <button className={`act ${kind}`} {...p}><span>{icon}</span>{label}</button>;
}

function PayTable({ pays }) {
  return (
    <aside className="paytable">
      <b>La Ciega paga</b>
      {PAYS.map(([k, name]) => <div key={k}><span>{name}</span><span>{pays[k] ? ratio(pays[k]) : 'Empata'}</span></div>)}
      <small>Con menos de escalera, la Ciega empata.</small>
    </aside>
  );
}

function Rules({ h }) {
  return (
    <div className="rules">
      Juegas contra el crupier con tus 2 cartas y las 5 de la mesa · El crupier califica con par o mejor
      {h?.winCommissionPct > 0 && ` · Comisión de ${h.winCommissionPct}% sobre ganancias`}
    </div>
  );
}

function Setup({ onSave }) {
  const [server, setServer] = useState('http://192.168.1.10:7021');
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');
  const test = async (e) => {
    e.preventDefault();
    try { await api('state', null, { server, token: token.trim() }); onSave({ server, token: token.trim() }); }
    catch (err) { setMsg(err.message); }
  };
  return (
    <div className="felt">
      <form className="setup" onSubmit={test}>
        <div className="logo big">♠<span>TEXAS HOLD'EM</span></div>
        <label>Dirección del servidor<input value={server} onChange={(e) => setServer(e.target.value)} /></label>
        <label>Clave de la máquina<input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Se copia desde el admin, sección Máquinas" /></label>
        <button className="deal">Conectar</button>
        {msg && <p className="err">{msg}</p>}
      </form>
    </div>
  );
}
