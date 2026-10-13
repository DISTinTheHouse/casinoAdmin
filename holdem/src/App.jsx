import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getConfig, setConfig, money } from './api.js';
import useCardReader from './useCardReader.js';
import { sfx, soundOn, setSound } from './sounds.js';

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

  if (!cfg) return <Setup onSave={(c) => { setConfig(c); setCfg(c); }} />;
  const other = state?.round && state.round.game !== 'holdem';
  return (
    <div className="felt">
      <Header state={state} onReset={() => { setConfig(null); setCfg(null); }} onExit={() => call('close')} />
      {!state ? <div className="center muted">Conectando…</div>
        : other ? <div className="center"><div className="empty">Esta tarjeta tiene una mano de 21 sin terminar. Termínala en la mesa de 21.</div></div>
        : state.card ? <Table state={state} call={call} />
        : <Idle onDemo={import.meta.env.DEV ? (uid) => call('open', { uid }) : null} />}
      {state && <Rules h={state.holdem} />}
      {error && <div className="toast">{error}</div>}
      {offline && <div className="offline">Sin conexión con el servidor. Reintentando…</div>}
    </div>
  );
}

function Header({ state, onReset, onExit }) {
  const taps = useRef(0);
  const [sound, setS] = useState(soundOn);
  const toggle = () => { setSound(!sound); setS(!sound); };
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
          <div className="balance">{money(state.card.balance)}</div>
          {!state.round || state.round.phase === 'done' ? <button className="exit" onClick={onExit}>Terminar y guardar saldo</button> : null}
        </div>
      )}
    </header>
  );
}

function Idle({ onDemo }) {
  return (
    <div className="center idle">
      <div className="nfc"><div className="card-icon">♠</div></div>
      <h1>Acerca tu tarjeta</h1>
      <p className="muted">para empezar a jugar</p>
      {onDemo && <button className="ghost" onClick={() => onDemo(prompt('Número de tarjeta') || '')}>Tarjeta de prueba</button>}
    </div>
  );
}

function Table({ state, call }) {
  const { card, round, holdem: limits } = state;
  const [ante, setAnte] = useState(() => Math.min(limits.minBet * 5, limits.maxBet));
  const [busy, setBusy] = useState(false);
  const lastTouch = useRef(Date.now());
  const playing = round?.phase === 'player';

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

  // Sonidos: una carta nueva = un "swish"; al terminar la mano, el sonido del resultado.
  const prev = useRef(null);
  useEffect(() => {
    const p = prev.current; prev.current = round;
    if (!round) return;
    const count = (r) => (r ? r.player.cards.length + r.board.length + r.dealer.cards.length : 0);
    const fresh = !p || p.seedHash !== round.seedHash;
    const added = count(round) - (fresh ? 0 : count(p));
    if (added > 0) sfx.deal(Math.min(added, 4));
    if (round.phase === 'done' && (fresh || p.phase !== 'done')) {
      const bet = round.ante + round.blind + round.play;
      setTimeout(() => (round.payout > bet && round.payout - bet >= round.blind * 3 ? sfx.blackjack()
        : round.payout > bet ? sfx.win() : round.payout === bet ? sfx.push() : sfx.lose()), 450);
    }
  }, [round]);

  const add = (c) => { sfx.chip(); lastTouch.current = Date.now(); setAnte((b) => Math.min(b + c, limits.maxBet, Math.floor(card.balance / 3))); };
  const canDeal = ante >= limits.minBet && ante * 3 <= card.balance;
  const bet = (x) => go('holdem/action', { action: `bet${x}` });
  const can = (x) => !busy && card.balance >= round.ante * x;
  const shown = round || { ante, blind: ante, play: 0 };

  return (
    <main className="table poker">
      <section className="seat dealer">
        <div className="label"><span>Crupier</span>{round?.dealer.hand && <b>{round.dealer.hand}</b>}
          {round?.phase === 'done' && !round.dealer.qualifies && <em>No califica: tu Ante regresa</em>}</div>
        <Hand cards={round?.dealer.cards} hidden={round ? round.dealer.hidden : false} empty={2} />
      </section>

      <section className="board">
        <Hand cards={round?.board} empty={5} spread />
        <div className="banner-slot">{round?.phase === 'done' && <Result round={round} />}</div>
      </section>

      <section className="seat player">
        <div className="hand-box">
          <Hand cards={round?.player.cards} empty={2} />
          <div className="label"><span>Tú</span>{round?.player.hand && <b>{round.player.hand}</b>}</div>
        </div>
        <div className="spots">
          <Spot label="Ante" value={shown.ante} />
          <Spot label="Ciega" value={shown.blind} />
          <Spot label="Juego" value={shown.play} gold />
        </div>
      </section>

      <footer className="controls">
        {playing ? (
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
    </main>
  );
}

function Result({ round }) {
  const bet = round.ante + round.blind + round.play;
  const [text, kind] = round.result === 'retira' ? ['Te retiraste', 'lose']
    : round.payout > bet ? [`¡Ganaste ${money(round.payout - bet)}!`, 'win']
    : round.payout === bet ? ['Empate', 'push']
    : round.payout > 0 ? [`Gana la casa · regresan ${money(round.payout)}`, 'lose'] : ['Gana la casa', 'lose'];
  return <div className={`banner ${kind}`}>{text}</div>;
}

const Spot = ({ label, value, gold }) => (
  <div className={'spot' + (value ? ' on' : '') + (gold ? ' gold' : '')}><small>{label}</small>{value ? money(value) : '—'}</div>
);

function Hand({ cards = [], hidden, empty, spread }) {
  const slots = Math.max(0, (hidden ? 0 : empty) - cards.length);
  return (
    <div className={'hand' + (spread ? ' spread' : '')}>
      {cards.map((c, i) => <Card key={i} c={c} delay={i} />)}
      {hidden && <><div className="card back" /><div className="card back" style={{ animationDelay: '120ms' }} /></>}
      {Array.from({ length: slots }, (_, i) => <div key={'s' + i} className="card slot" />)}
    </div>
  );
}

function Card({ c, delay }) {
  const red = c.s === '♥' || c.s === '♦';
  return (
    <div className={'card' + (red ? ' red' : '')} style={{ animationDelay: `${Math.min(delay, 2) * 120}ms` }}>
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
