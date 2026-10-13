import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getConfig, setConfig, money } from './api.js';
import useCardReader from './useCardReader.js';
import { sfx, soundOn, setSound } from './sounds.js';
import useUpdate from './update.js';

const CHIPS = [1000, 5000, 10000, 50000]; // centavos: $10, $50, $100, $500
const IDLE_MS = 120000;

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

  const update = useUpdate(cfg?.server, 'game');

  if (!cfg) return <Setup onSave={(c) => { setConfig(c); setCfg(c); }} />;
  return (
    <div className="felt">
      <Header state={state} onReset={() => { setConfig(null); setCfg(null); }} onExit={() => call('close')} />
      {!state ? <div className="center muted">Conectando…</div>
        : state.card ? <Table state={state} call={call} />
        : <Idle update={update} onDemo={import.meta.env.DEV ? (uid) => call('open', { uid }) : null} />}
      {state && <Rules rules={state.rules} />}
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
        <div className="logo" onClick={secret}>21<span>BLACKJACK</span></div>
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

function Idle({ onDemo, update }) {
  return (
    <div className="center idle">
      <div className="nfc"><div className="card-icon">21</div></div>
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

function Table({ state, call }) {
  const { card, round, limits } = state;
  const [bet, setBet] = useState(() => Math.min(limits.minBet * 5, limits.maxBet));
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
    const count = (r) => (r ? r.dealer.cards.length + r.hands.reduce((n, h) => n + h.cards.length, 0) : 0);
    const fresh = !p || p.seedHash !== round.seedHash;
    const added = count(round) - (fresh ? 0 : count(p));
    if (added > 0) sfx.deal(Math.min(added, 4));
    if (round.phase === 'done' && (fresh || p.phase !== 'done')) {
      const bet = round.hands.reduce((n, h) => n + h.bet, 0), paid = round.hands.reduce((n, h) => n + h.payout, 0);
      setTimeout(() => (round.hands.some((h) => h.result === 'blackjack') && paid > bet ? sfx.blackjack()
        : paid > bet ? sfx.win() : paid === bet ? sfx.push() : sfx.lose()), 450);
    }
  }, [round]);

  const add = (c) => { sfx.chip(); lastTouch.current = Date.now(); setBet((b) => Math.min(b + c, limits.maxBet, card.balance)); };
  const canDeal = bet >= limits.minBet && bet <= card.balance;

  return (
    <main className="table">
      <section className="seat dealer">
        <Label text="Crupier" total={round?.dealer.total} hidden={round?.dealer.hidden} />
        <Hand cards={round?.dealer.cards} hidden={round?.dealer.hidden} />
      </section>

      <div className="banner-slot">{round?.phase === 'done' && <Result round={round} />}</div>

      <section className="seat player">
        {(round?.hands || [{}]).map((h, i) => (
          <div key={i} className={'hand-box' + (playing && i === round.active && round.hands.length > 1 ? ' active' : '')}>
            <Hand cards={h.cards} />
            {h.cards && <Label text={round.hands.length > 1 ? `Mano ${i + 1}` : 'Tú'} total={h.total} bet={h.bet} />}
          </div>
        ))}
      </section>

      <footer className="controls">
        {playing ? (
          <div className="actions">
            <Btn icon="＋" label="Pedir" kind="hit" onClick={() => go('action', { action: 'hit' })} disabled={busy} />
            <Btn icon="✋" label="Plantarse" kind="stand" onClick={() => go('action', { action: 'stand' })} disabled={busy} />
            {round.options.double && <Btn icon="×2" label="Doblar" kind="double" onClick={() => go('action', { action: 'double' })} disabled={busy || card.balance < round.hands[round.active].bet} />}
            {round.options.split && <Btn icon="⇆" label="Dividir" kind="split" onClick={() => go('action', { action: 'split' })} disabled={busy || card.balance < round.hands[round.active].bet} />}
          </div>
        ) : card.balance < limits.minBet ? (
          <div className="empty">Saldo insuficiente. Recarga en caja para seguir jugando.</div>
        ) : (
          <div className="betting">
            <div className="chips">
              {CHIPS.filter((c) => c <= limits.maxBet).map((c) => (
                <button key={c} className={`chip c${c}`} onClick={() => add(c)} disabled={card.balance < c}>{money(c)}</button>
              ))}
            </div>
            <div className="bet">
              <small>Tu apuesta</small>{money(bet)}
              <button className="clear" onClick={() => setBet(0)}>Borrar</button>
            </div>
            <button className="deal" disabled={!canDeal || busy} onClick={() => go('deal', { bet })}>Repartir</button>
          </div>
        )}
      </footer>
    </main>
  );
}

function Result({ round }) {
  const bet = round.hands.reduce((s, h) => s + h.bet, 0);
  const paid = round.hands.reduce((s, h) => s + h.payout, 0);
  const bj = round.hands.some((h) => h.result === 'blackjack');
  const [text, kind] = paid > bet ? [bj ? `¡Blackjack! +${money(paid - bet)}` : `¡Ganaste ${money(paid - bet)}!`, 'win']
    : paid === bet ? ['Empate', 'push'] : ['Gana la casa', 'lose'];
  return <div className={`banner ${kind}`}>{text}</div>;
}

function Label({ text, total, hidden, bet }) {
  if (total == null) return <div className="label"><span>{text}</span></div>;
  return (
    <div className="label">
      <span>{text}</span>
      <b className={total > 21 ? 'bust' : total === 21 ? 'twentyone' : ''}>{total > 21 ? `${total} · Te pasaste` : total}{hidden ? ' + ?' : ''}</b>
      {bet != null && <em>{money(bet)}</em>}
    </div>
  );
}

function Hand({ cards = [], hidden }) {
  return (
    <div className="hand">
      {cards.map((c, i) => <Card key={i} c={c} delay={i} />)}
      {hidden && <div className="card back" style={{ animationDelay: '120ms' }} />}
      {!cards.length && <div className="card slot" />}
    </div>
  );
}

function Card({ c, delay }) {
  const red = c.s === '♥' || c.s === '♦';
  return (
    <div className={'card' + (red ? ' red' : '')} style={{ animationDelay: `${Math.min(delay, 1) * 120}ms` }}>
      <span className="corner">{c.r}<br />{c.s}</span>
      <span className="pip">{c.s}</span>
      <span className="corner br">{c.r}<br />{c.s}</span>
    </div>
  );
}

function Btn({ icon, label, kind, ...p }) {
  return <button className={`act ${kind}`} {...p}><span>{icon}</span>{label}</button>;
}

function Rules({ rules }) {
  return (
    <div className="rules">
      Blackjack paga {rules.bjPays.replace(':', ' a ')} · El crupier {rules.dealerHitsSoft17 ? 'pide' : 'se planta'} en 17 suave
      {rules.winCommissionPct > 0 && ` · Comisión de ${rules.winCommissionPct}% sobre ganancias`}
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
        <div className="logo big">21<span>BLACKJACK</span></div>
        <label>Dirección del servidor<input value={server} onChange={(e) => setServer(e.target.value)} /></label>
        <label>Clave de la máquina<input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Se copia desde el admin, sección Máquinas" /></label>
        <button className="deal">Conectar</button>
        {msg && <p className="err">{msg}</p>}
      </form>
    </div>
  );
}
