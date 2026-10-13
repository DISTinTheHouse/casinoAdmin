import { useCallback, useEffect, useState } from 'react';
import { api, getSession, setSession, lastServer, money, pct, time } from './api.js';

const GAME = { 21: '21', holdem: "Hold'em" };
const TABS = ['Resumen', 'Caja', 'Máquinas', 'Reglas', 'Bitácora'];

export default function App() {
  const [session, setS] = useState(getSession);
  const [tab, setTab] = useState('Resumen');
  if (!session) return <Login onLogin={(s) => { setSession(s); setS(s); }} />;
  const Page = { Resumen, Caja, Máquinas: Machines, Reglas: Rules, Bitácora: Log }[tab];
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand"><span className="mark">21</span> Blackjack <span className="slash">/</span> Admin</div>
        <div className="tabs">{TABS.map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
        <button className="link" onClick={() => { setSession(null); setS(null); }}>Salir</button>
      </nav>
      <main className="page"><Page /></main>
    </div>
  );
}

// Carga + recarga periódica de un endpoint.
function useApi(path, every) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api(path).then((d) => { setData(d); setError(''); }, (e) => setError(e.message)), [path]);
  useEffect(() => {
    load();
    if (!every) return;
    const t = setInterval(load, every);
    return () => clearInterval(t);
  }, [load, every]);
  return [data, load, error];
}

function Login({ onLogin }) {
  const [server, setServer] = useState(lastServer);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { await api('settings', null, { server, pin }); localStorage.setItem('bj.server', server); onLogin({ server, pin }); }
    catch (x) { setErr(x.message); }
  };
  return (
    <form className="login" onSubmit={submit}>
      <div className="brand big"><span className="mark">21</span> Admin</div>
      <label>Servidor<input value={server} onChange={(e) => setServer(e.target.value)} /></label>
      <label>PIN<input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus /></label>
      <button className="primary">Entrar</button>
      {err && <p className="error">{err}</p>}
    </form>
  );
}

function Resumen() {
  const [s, load, err] = useApi('summary', 3000);
  const [nights] = useApi('nights', 30000);
  if (!s) return <Empty err={err} />;
  const closeNight = async () => {
    if (confirm(`¿Cerrar la noche #${s.night.id}? Se guarda el resultado y empieza una nueva.`)) { await api('night/close', {}); load(); }
  };
  const release = async (m) => {
    if (!confirm(`¿Liberar la tarjeta de ${m.card_name || m.card_uid} en ${m.name}?`)) return;
    try { await api('machines/release', { id: m.id }); load(); } catch (x) { alert(x.message); }
  };
  const ratio = Math.min(s.retentionPct / Math.max(s.targetPct * 1.5, 1), 1);
  return (
    <>
      <Head title={`Noche #${s.night.id}`} sub={`Abierta ${time(s.night.opened_at)}`}>
        <button onClick={closeNight}>Cerrar noche</button>
      </Head>
      <div className="grid kpis">
        <Kpi label="Total apostado" value={money(s.bet)} />
        <Kpi label="Pagado a jugadores" value={money(s.paid)} />
        <Kpi label="Ganancia de la casa" value={money(s.house)} tone={s.house >= 0 ? 'good' : 'bad'} />
        <div className="kpi">
          <small>Retención real · meta {pct(s.targetPct)}</small>
          <b className={s.retentionPct >= s.targetPct ? 'good' : ''}>{pct(s.retentionPct)}</b>
          <div className="meter"><i style={{ width: `${ratio * 100}%` }} /><em style={{ left: `${(s.targetPct / Math.max(s.targetPct * 1.5, 1)) * 100}%` }} /></div>
        </div>
        <Kpi label="Recargas en caja" value={money(s.recharged)} />
        <Kpi label="Cobros en caja" value={money(s.cashedOut)} />
        <Kpi label="Manos jugadas" value={s.hands.toLocaleString('es-MX')} />
        <Kpi label="Máquinas en línea" value={`${s.machines.filter((m) => m.online).length} / ${s.machines.length}`} />
      </div>
      {s.byGame.length > 0 && <>
        <h3>Por juego</h3>
        <Table cols={['Juego', 'Manos', 'Apostado', 'Ganancia casa', 'Retención']} rows={s.byGame.map((g) => [
          GAME[g.game] || g.game, g.hands.toLocaleString('es-MX'), money(g.bet), money(g.house), pct(g.retentionPct),
        ])} />
      </>}
      <h3>Máquinas</h3>
      <Table cols={['Máquina', 'Juego', 'Estado', 'Jugador', 'Saldo', 'Manos', 'Ganancia casa', '']} rows={s.machines.map((m) => [
        m.name, m.game ? GAME[m.game] : <span className="dim">—</span>, <Dot on={m.online} />, m.card_uid ? (m.card_name || m.card_uid) : <span className="dim">Libre</span>,
        m.card_uid ? money(m.balance) : '—', m.hands, money(m.house),
        m.card_uid && !m.online ? <button className="link" onClick={() => release(m)}>Liberar</button> : '',
      ])} empty="Agrega máquinas en la pestaña Máquinas" />
      {nights?.length > 1 && <>
        <h3>Noches anteriores</h3>
        <Table cols={['Noche', 'Apertura', 'Apostado', 'Ganancia casa', 'Retención']} rows={nights.slice(1, 11).map((n) => [
          `#${n.night.id}`, time(n.night.opened_at), money(n.bet), money(n.house), pct(n.retentionPct),
        ])} />
      </>}
    </>
  );
}

function Caja() {
  const [shift, reloadShift] = useApi('shift', 0);
  const [uid, setUid] = useState('');
  const [card, setCard] = useState(null); // null = nada, false = no registrada
  const [history, setHistory] = useState(null);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState('');
  const [report, setReport] = useState(null);
  const [list, reload] = useApi('cards', 0);

  const loadHistory = (u) => api(`history?uid=${encodeURIComponent(u)}`).then(setHistory, () => setHistory(null));
  const run = async (fn) => {
    try { setMsg(''); await fn(); reload(); reloadShift(); } catch (e) { setMsg(e.message); }
  };
  const show = (c) => { setCard(c); setName(c?.name || ''); if (c) loadHistory(c.uid); else setHistory(null); };
  const find = (e) => {
    e?.preventDefault();
    run(async () => show((await api(`cards?q=${encodeURIComponent(uid.trim())}`)).find((c) => c.uid === uid.trim()) || false));
  };
  const select = (c) => { setUid(c.uid); show(c); };
  const after = (c, text) => { show(c); setMsg(text); };
  const recharge = (v) => run(async () => { after(await api('recharge', { uid: card.uid, amount: v }), `Recarga de ${money(v * 100)} lista`); setAmount(''); });
  const undo = (m) => confirm(`¿Corregir la recarga de ${money(m.amount)}? Se le quita a la tarjeta y se descuenta del turno.`) &&
    run(async () => after(await api('recharge/undo', { id: m.id }), `Recarga de ${money(m.amount)} corregida`));
  const cashout = () => confirm(`¿Entregar ${money(card.balance)} en efectivo y dejar la tarjeta en $0?`) &&
    run(async () => { const r = await api('cashout', { uid: card.uid }); after({ ...r, balance: 0 }, `Entregar ${money(r.paidOut)} en efectivo`); });

  if (!shift) return <Empty />;
  const cur = shift.current;
  return (
    <>
      <Head title="Caja" sub={cur ? `Turno #${cur.shift.id} · ${cur.shift.cashier} · desde ${time(cur.shift.opened_at)}` : 'Abre un turno para recargar y cobrar'}>
        {cur && <div className="row">
          <button onClick={() => setReport(cur)}>Corte de caja</button>
          <button onClick={() => confirm('¿Cerrar el turno? Después se imprime el corte.') && run(async () => setReport(await api('shift/close', {})))}>Cerrar turno</button>
        </div>}
      </Head>
      {report && <Report r={report} onClose={() => setReport(null)} />}
      {!cur ? <OpenShift onOpen={(cashier) => run(() => api('shift/open', { cashier }))} recent={shift.recent} onReport={async (id) => setReport(await api(`shift/report?id=${id}`))} /> : <>
        <div className="grid kpis three">
          <Kpi label={`Recargas (${cur.recargas.n})`} value={money(cur.recargas.total - cur.correcciones.total)} />
          <Kpi label={`Cobros (${cur.cobros.n})`} value={money(cur.cobros.total)} />
          <Kpi label="Efectivo esperado en caja" value={money(cur.efectivo)} />
        </div>
        <form className="search" onSubmit={find} style={{ marginTop: 24 }}>
          <input value={uid} onChange={(e) => setUid(e.target.value)} placeholder="Acerca la tarjeta al lector o escribe su número" autoFocus />
          <button className="primary">Buscar</button>
        </form>
      </>}
      {cur && card === false && (
        <div className="panel">
          <p>Tarjeta <code>{uid}</code> sin registrar.</p>
          <div className="row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (opcional)" />
            <button className="primary" onClick={() => run(async () => show(await api('cards', { uid: uid.trim(), name })))}>Registrar</button>
          </div>
        </div>
      )}
      {cur && card && (
        <div className="panel">
          <div className="card-head">
            <div>
              <input className="plain" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sin nombre"
                onBlur={() => name !== (card.name || '') && run(async () => show(await api('cards', { uid: card.uid, name })))} />
              <code>{card.uid}</code>{card.machine_id && <span className="tag">Jugando</span>}
            </div>
            <div className="big-num">{money(card.balance)}</div>
          </div>
          <div className="row">
            {[100, 200, 500, 1000].map((v) => <button key={v} onClick={() => recharge(v)}>+ {money(v * 100)}</button>)}
            <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Otro monto" />
            <button className="primary" disabled={!(amount > 0)} onClick={() => recharge(Number(amount))}>Recargar</button>
            <span className="spacer" />
            <button className="danger" disabled={!card.balance || card.machine_id} onClick={cashout}>Cobrar saldo</button>
          </div>
          {msg && <p className="note">{msg}</p>}
          {history && <History h={history} onUndo={undo} />}
        </div>
      )}
      {cur && !card && msg && <p className="note">{msg}</p>}
      {cur && <>
        <h3>Tarjetas recientes</h3>
        <Table cols={['Tarjeta', 'Nombre', 'Saldo', '']} rows={(list || []).map((c) => [
          <code>{c.uid}</code>, c.name || <span className="dim">—</span>, money(c.balance),
          <button className="link" onClick={() => select(c)}>Abrir</button>,
        ])} empty="Aún no hay tarjetas" />
      </>}
    </>
  );
}

const KIND = { recarga: 'Recarga', cobro: 'Cobro', correccion: 'Corrección', mano: 'Mano' };

function History({ h, onUndo }) {
  const [all, setAll] = useState(false);
  if (!h.moves.length) return <p className="dim" style={{ marginTop: 16 }}>Sin movimientos todavía.</p>;
  return (
    <>
    <Table cols={['Hora', 'Movimiento', 'Detalle', 'Monto', '']} rows={h.moves.slice(0, all ? 40 : 10).map((m) => m.kind === 'mano' ? [
      time(m.at), <span className="tag">Mano</span>, `${GAME[m.game] || ''} · ${m.machine || 'Máquina'} · apostó ${money(m.bet)}`,
      <span className={m.payout - m.bet > 0 ? 'good' : m.payout - m.bet < 0 ? 'bad' : ''}>{m.payout - m.bet > 0 ? '+' : m.payout - m.bet < 0 ? '−' : ''}{money(Math.abs(m.payout - m.bet))}</span>, '',
    ] : [
      time(m.at), <span className="tag">{KIND[m.kind]}</span>, m.corrected ? <span className="dim">Corregida</span> : '',
      <span>{m.kind === 'recarga' ? '+' : '−'}{money(m.amount)}</span>,
      m.kind === 'recarga' && !m.corrected && m.shift_id === h.shiftId ? <button className="link danger" onClick={() => onUndo(m)}>Corregir</button> : '',
    ])} />
    {!all && h.moves.length > 10 && <button className="link" style={{ marginTop: 10 }} onClick={() => setAll(true)}>Ver más movimientos</button>}
    </>
  );
}

function OpenShift({ onOpen, recent, onReport }) {
  const [cashier, setCashier] = useState('');
  return (
    <>
      <form className="panel row" onSubmit={(e) => { e.preventDefault(); onOpen(cashier); }}>
        <input value={cashier} onChange={(e) => setCashier(e.target.value)} placeholder="Nombre del cajero" autoFocus style={{ flex: 1 }} />
        <button className="primary">Abrir turno</button>
      </form>
      {recent.length > 0 && <>
        <h3>Turnos anteriores</h3>
        <Table cols={['Turno', 'Cajero', 'Abrió', 'Cerró', '']} rows={recent.map((t) => [
          `#${t.id}`, t.cashier, time(t.opened_at), t.closed_at ? time(t.closed_at) : '—',
          <button className="link" onClick={() => onReport(t.id)}>Ver corte</button>,
        ])} />
      </>}
    </>
  );
}

// Corte de caja imprimible.
function Report({ r, onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="report print-area" onClick={(e) => e.stopPropagation()}>
        <div className="head">
          <div><h1>Corte de caja · Turno #{r.shift.id}</h1>
            <p className="dim">{r.shift.cashier} · {time(r.shift.opened_at)} a {r.shift.closed_at ? time(r.shift.closed_at) : 'ahora (turno abierto)'}</p></div>
          <div className="row no-print"><button onClick={() => window.print()}>Imprimir</button><button onClick={onClose}>Cerrar</button></div>
        </div>
        <table className="totals"><tbody>
          <tr><td>Recargas ({r.recargas.n})</td><td>{money(r.recargas.total)}</td></tr>
          <tr><td>Correcciones ({r.correcciones.n})</td><td>− {money(r.correcciones.total)}</td></tr>
          <tr><td>Cobros ({r.cobros.n})</td><td>− {money(r.cobros.total)}</td></tr>
          <tr className="sum"><td>Efectivo esperado</td><td>{money(r.efectivo)}</td></tr>
        </tbody></table>
        <h3>Movimientos</h3>
        <table className="moves"><tbody>{r.moves.map((m) => (
          <tr key={m.id}><td>{time(m.at)}</td><td>{KIND[m.kind]}</td><td>{m.name || m.card_uid}</td>
            <td>{m.kind === 'recarga' ? '' : '− '}{money(m.amount)}</td></tr>
        ))}</tbody></table>
        <div className="signs"><span>Firma cajero</span><span>Firma supervisor</span></div>
      </div>
    </div>
  );
}

function Machines() {
  const [list, , err] = useApi('machines', 0);
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');
  const data = rows || list;
  const add = async (e) => { e.preventDefault(); setRows(await api('machines', { name: name || `Máquina ${(data?.length || 0) + 1}` })); setName(''); };
  const del = async (m) => { if (confirm(`¿Dar de baja ${m.name}?`)) { try { setRows(await api('machines/delete', { id: m.id })); } catch (x) { alert(x.message); } } };
  if (!data) return <Empty err={err} />;
  return (
    <>
      <Head title="Máquinas" sub="Cada máquina se conecta con su clave la primera vez que se abre" />
      <form className="search" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Máquina ${data.length + 1}`} />
        <button className="primary">Agregar máquina</button>
      </form>
      <Table cols={['Nombre', 'Clave', '']} rows={data.map((m) => [
        m.name,
        <span className="row"><code>{m.token}</code><button className="link" onClick={() => navigator.clipboard.writeText(m.token)}>Copiar</button></span>,
        <button className="link danger" onClick={() => del(m)}>Dar de baja</button>,
      ])} empty="Aún no hay máquinas" />
    </>
  );
}

// Cada juego tiene su propio configurador; meta, PIN y respaldos van en General.
const RULE_TABS = ['21 Blackjack', "Texas Hold'em", 'General'];

function Rules() {
  const [s, load, err] = useApi('settings', 0);
  const [tab, setTab] = useState(RULE_TABS[0]);
  if (!s) return <Empty err={err} />;
  const Page = { '21 Blackjack': Rules21, "Texas Hold'em": RulesHoldem, General: RulesGeneral }[tab];
  return (
    <>
      <Head title="Reglas" sub="Iguales para todas las máquinas y todos los jugadores" />
      <div className="subtabs">{RULE_TABS.map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      <Page key={tab} s={s} load={load} />
    </>
  );
}

// Formulario de una sección: guarda solo sus propios campos.
function useRulesForm(initial, toBody, load) {
  const [form, setForm] = useState(initial);
  const [msg, setMsg] = useState('');
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try { await api('settings', toBody(form)); setMsg('Guardado. Las máquinas usan las reglas nuevas desde la siguiente mano.'); load(); return true; }
    catch (x) { setMsg(x.message); return false; }
  };
  return { form, setForm, f, save, msg, setMsg };
}

// ---------- Configurador de cada juego ----------
// Cada juego describe sus campos; el mismo componente da secciones, ayudas, retención esperada contra real,
// confirmación de cambios (antes → después) e historial.
const yesNo = (v) => (v ? 'Sí' : 'No');
const ratio = (x) => (+x === 0 ? 'Empata' : Number.isInteger(+x) ? `${x} a 1` : Number.isInteger(x * 2) ? `${x * 2} a 2` : `${x} a 1`);
const opts = (list, fmt = String) => list.map((v) => [String(v), fmt(v)]);

const GAMES = {
  21: {
    sim: ['Experto (estrategia básica)', 'Casual (pide hasta 17)'],
    // Valores planos y comparables (dinero en pesos), desde lo que guarda el servidor o la bitácora.
    flat: (x) => x.rules && x.limits && ({ ...x.rules, minBet: x.limits.minBet / 100, maxBet: x.limits.maxBet / 100 }),
    recommended: (s) => ({ ...s.recommended.rules }),
    body: (f) => ({ rules: { decks: +f.decks, bjPays: f.bjPays, dealerHitsSoft17: String(f.dealerHitsSoft17) === 'true', winCommissionPct: +f.winCommissionPct },
      limits: { minBet: +f.minBet, maxBet: +f.maxBet } }),
    sections: [
      { title: 'Reglas de la mesa', fields: [
        { key: 'decks', label: 'Barajas en el zapato', type: 'select', options: opts([1, 2, 4, 6, 8]), help: 'Más barajas = un poco más de ventaja para la casa y menos conteo de cartas.' },
        { key: 'bjPays', label: 'Blackjack paga', type: 'select', options: opts(['3:2', '6:5', '1:1'], (v) => v.replace(':', ' a ')), help: '3 a 2 es el clásico; 6 a 5 sube la ventaja de la casa ≈1.4%.' },
        { key: 'dealerHitsSoft17', label: 'Crupier con 17 suave', type: 'select', options: [['true', 'Pide carta'], ['false', 'Se planta']], fmt: (v) => (String(v) === 'true' ? 'Pide carta' : 'Se planta'), help: 'Que pida carta sube la ventaja de la casa ≈0.2%.' },
      ] },
      { title: 'Apuestas', fields: [
        { key: 'minBet', label: 'Apuesta mínima', type: 'money' },
        { key: 'maxBet', label: 'Apuesta máxima', type: 'money', help: 'Al doblar o dividir se puede arriesgar hasta 2 veces esta apuesta.' },
      ] },
      { title: 'Comisión', fields: [
        { key: 'winCommissionPct', label: 'Comisión sobre ganancias', type: 'pct', help: 'Se descuenta solo de lo que el jugador gana, nunca de lo apostado. Se le muestra en la mesa.' },
      ] },
    ],
    player: (f) => `Blackjack paga ${f.bjPays.replace(':', ' a ')} · El crupier ${String(f.dealerHitsSoft17) === 'true' ? 'pide' : 'se planta'} en 17 suave${+f.winCommissionPct > 0 ? ` · Comisión de ${f.winCommissionPct}% sobre ganancias` : ''}`,
  },
  holdem: {
    sim: ['Experto (apuesta con buenas manos)', 'Casual (solo apuesta al final con par)'],
    flat: (x) => x.holdem && ({ winCommissionPct: x.holdem.winCommissionPct, allow3x: x.holdem.allow3x ?? true,
      minBet: x.holdem.minBet != null ? x.holdem.minBet / 100 : undefined, maxBet: x.holdem.maxBet != null ? x.holdem.maxBet / 100 : undefined,
      ...Object.fromEntries(Object.entries(x.holdem.blindPays || {}).map(([k, v]) => [`pay${k}`, v])) }),
    recommended: (s) => GAMES.holdem.flat({ holdem: s.recommended.holdem }),
    body: (f) => ({ holdem: { winCommissionPct: +f.winCommissionPct, minBet: +f.minBet, maxBet: +f.maxBet, allow3x: String(f.allow3x) === 'true',
      blindPays: Object.fromEntries([4, 5, 6, 7, 8, 9].map((k) => [k, +f[`pay${k}`]])) } }),
    sections: [
      { title: 'Reglas de la mesa', fields: [
        { key: 'allow3x', label: 'Apuesta antes del flop', type: 'select', options: [['true', '4× o 3× el Ante'], ['false', 'Solo 4× el Ante']], fmt: (v) => (String(v) === 'true' ? '4× o 3×' : 'Solo 4×'), help: 'Quitar el 3× es más simple para el jugador; casi no cambia la ventaja.' },
      ] },
      { title: 'Apuestas', fields: [
        { key: 'minBet', label: 'Ante mínimo', type: 'money', help: 'La Ciega es igual al Ante. Para repartir se pide en saldo 3 veces el Ante.' },
        { key: 'maxBet', label: 'Ante máximo', type: 'money', help: 'Con Ante + Ciega + 4× el jugador arriesga hasta 6 veces el Ante por mano.' },
      ] },
      { title: 'La Ciega paga (si gana el jugador)', fields: [
        { key: 'pay9', label: 'Escalera real', type: 'select', options: opts([500, 300, 200, 100], ratio) },
        { key: 'pay8', label: 'Escalera de color', type: 'select', options: opts([100, 50, 40, 30], ratio) },
        { key: 'pay7', label: 'Póker', type: 'select', options: opts([10, 9, 8], ratio) },
        { key: 'pay6', label: 'Full', type: 'select', options: opts([3, 2], ratio) },
        { key: 'pay5', label: 'Color', type: 'select', options: opts([1.5, 1], ratio) },
        { key: 'pay4', label: 'Escalera', type: 'select', options: opts([1, 0], ratio), help: 'Con menos de escalera la Ciega siempre empata. Bajar estos pagos sube la ventaja de la casa.' },
      ] },
      { title: 'Comisión', fields: [
        { key: 'winCommissionPct', label: 'Comisión sobre ganancias', type: 'pct', help: 'Se descuenta solo de lo que el jugador gana en la mano, nunca de lo apostado. Se le muestra en la mesa.' },
      ] },
    ],
    player: (f) => `Juegas contra el crupier con tus 2 cartas y las 5 de la mesa · El crupier califica con par o mejor${+f.winCommissionPct > 0 ? ` · Comisión de ${f.winCommissionPct}% sobre ganancias` : ''}`,
  },
};
const fieldsOf = (g) => GAMES[g].sections.flatMap((x) => x.fields);
const show = (field, v) => (v == null ? '—' : field.fmt ? field.fmt(v) : field.type === 'money' ? money(v * 100)
  : field.type === 'pct' ? `${v}%` : field.options ? (field.options.find(([o]) => o === String(v))?.[1] ?? String(v)) : String(v));
const diff = (g, a, b) => fieldsOf(g).filter((x) => a?.[x.key] != null && b?.[x.key] != null && String(a[x.key]) !== String(b[x.key]))
  .map((x) => ({ label: x.label, from: show(x, a[x.key]), to: show(x, b[x.key]) }));

const Rules21 = (p) => <GameConfig game="21" {...p} />;
const RulesHoldem = (p) => <GameConfig game="holdem" {...p} />;

function GameConfig({ game, s, load }) {
  const G = GAMES[game];
  const saved = G.flat(s);
  const [form, setForm] = useState(saved);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState('');
  const [sim, setSim] = useState(null);
  const [simBusy, setSimBusy] = useState(false);
  const [summary] = useApi('summary', 15000);
  const [history, loadHistory] = useApi('rules-history', 0);
  const runSim = useCallback(async () => {
    setSimBusy(true);
    try { setSim(await api('simulate', { game })); } catch (x) { setMsg(x.message); }
    setSimBusy(false);
  }, [game]);
  useEffect(() => { runSim(); }, [runSim]);

  const changes = diff(game, saved, form);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    try {
      await api('settings', G.body(form));
      setConfirming(false); setMsg('Guardado. Las máquinas usan las reglas nuevas desde la siguiente mano.');
      await load(); loadHistory(); runSim();
    } catch (x) { setConfirming(false); setMsg(x.message); }
  };
  const real = summary?.byGame.find((x) => x.game === game);
  const target = s.targetPct;
  const tone = (v) => (v == null ? '' : v >= target ? 'good' : 'bad');
  // Historial: cada guardado de la bitácora comparado con el anterior, solo con los campos de este juego.
  const past = (history || []).map((e, i, arr) => ({ at: e.at, changes: diff(game, G.flat(arr[i + 1] || {}), G.flat(e)) }))
    .filter((e) => e.changes.length).slice(0, 8);

  return (
    <>
      <div className="grid kpis three">
        <div className="kpi">
          <small>Retención esperada (simulador)</small>
          <b className={tone(sim?.basica.retencionPct)}>{sim ? `${pct(sim.basica.retencionPct)} – ${pct(sim.casual.retencionPct)}` : simBusy ? 'Calculando…' : '—'}</b>
          <small>De jugador experto a casual, con las reglas guardadas</small>
        </div>
        <div className="kpi">
          <small>Retención real esta noche</small>
          <b className={real ? tone(real.retentionPct) : ''}>{real ? pct(real.retentionPct) : '—'}</b>
          <small>{real ? `${real.hands.toLocaleString('es-MX')} manos · ${money(real.bet)} apostado` : 'Aún no hay manos de este juego'}</small>
        </div>
        <div className="kpi">
          <small>Meta de retención</small>
          <b>{pct(target)}</b>
          <small>Se cambia en General</small>
        </div>
      </div>

      {G.sections.map((sec) => (
        <section key={sec.title}>
          <h3>{sec.title}</h3>
          <div className="panel form">
            {sec.fields.map((x) => (
              <label key={x.key} className={'field' + (String(saved[x.key]) !== String(form[x.key]) ? ' changed' : '')}>
                <span>{x.label}</span>
                {x.options ? <select value={String(form[x.key])} onChange={set(x.key)}>{x.options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
                  : <div className="unit"><input type="number" min="0" step={x.type === 'pct' ? 0.5 : 1} max={x.type === 'pct' ? 50 : undefined}
                    value={form[x.key]} onChange={set(x.key)} /><em>{x.type === 'money' ? '$' : '%'}</em></div>}
                {x.help && <small className="help">{x.help}</small>}
              </label>
            ))}
          </div>
        </section>
      ))}

      <h3>Así lo ve el jugador</h3>
      <div className="panel preview">{G.player(form)}</div>

      <div className={'savebar' + (changes.length ? ' dirty' : '')}>
        <span>{changes.length ? `${changes.length} ${changes.length === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}` : msg || 'Sin cambios'}</span>
        <span className="spacer" />
        <button type="button" onClick={() => { setForm({ ...form, ...G.recommended(s) }); setMsg(''); }}>Usar reglas recomendadas</button>
        <button type="button" disabled={!changes.length} onClick={() => setForm(saved)}>Descartar</button>
        <button type="button" className="primary" disabled={!changes.length} onClick={() => setConfirming(true)}>Revisar y guardar</button>
      </div>

      {confirming && (
        <div className="modal" onClick={() => setConfirming(false)}>
          <div className="panel confirm" onClick={(e) => e.stopPropagation()}>
            <h2>¿Guardar estos cambios?</h2>
            <p className="dim">Aplican a todas las máquinas de {game === 'holdem' ? "Texas Hold'em" : '21'} desde la siguiente mano. Quedan en la bitácora.</p>
            <Table cols={['Regla', 'Antes', 'Después']} rows={changes.map((c) => [c.label, <span className="dim">{c.from}</span>, <b>{c.to}</b>])} />
            <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirming(false)}>Cancelar</button>
              <button className="primary" onClick={save}>Guardar cambios</button>
            </div>
          </div>
        </div>
      )}

      <h3>Simulador</h3>
      <div className="panel">
        <div className="row">
          <span className="dim" style={{ flex: 1 }}>Juega 100,000 manos con las reglas guardadas y calcula cuánto retiene la casa de lo apostado.</span>
          <button onClick={runSim} disabled={simBusy}>{simBusy ? 'Simulando…' : 'Volver a simular'}</button>
        </div>
        {sim && <Table cols={['Tipo de jugador', 'Ventaja por reglas', 'Retención esperada', `Comisión para llegar a ${pct(target)}`]} rows={[
          [G.sim[0], pct(sim.basica.ventajaReglasPct), <span className={tone(sim.basica.retencionPct)}>{pct(sim.basica.retencionPct)}</span>, `≈ ${sim.basica.comisionParaMeta}%`],
          [G.sim[1], pct(sim.casual.ventajaReglasPct), <span className={tone(sim.casual.retencionPct)}>{pct(sim.casual.retencionPct)}</span>, `≈ ${sim.casual.comisionParaMeta}%`],
        ]} />}
      </div>

      <h3>Historial de cambios</h3>
      {past.length ? <Table cols={['Fecha', 'Cambios']} rows={past.map((e) => [time(e.at),
        e.changes.map((c) => <div key={c.label}>{c.label}: <span className="dim">{c.from}</span> → <b>{c.to}</b></div>)])} />
        : <div className="panel dim">Sin cambios registrados todavía.</div>}
    </>
  );
}

function RulesGeneral({ s, load }) {
  const { form, setForm, f, save, msg, setMsg } = useRulesForm({ targetPct: s.targetPct, adminPin: '' },
    (x) => ({ targetPct: +x.targetPct, adminPin: x.adminPin || undefined }), load);
  const saveAll = async (e) => { if ((await save(e)) && form.adminPin) { setSession({ ...getSession(), pin: form.adminPin }); setForm({ ...form, adminPin: '' }); } };
  return (
    <>
      <form className="panel form" onSubmit={saveAll}>
        <Field label="Meta de retención % (todos los juegos)"><input type="number" min="0" max="50" value={form.targetPct} onChange={f('targetPct')} /></Field>
        <Field label="Nuevo PIN admin"><input type="password" value={form.adminPin} onChange={f('adminPin')} placeholder="Dejar vacío para no cambiar" /></Field>
        <div className="row">
          <button className="primary">Guardar</button>
          {msg && <span className="note">{msg}</span>}
        </div>
      </form>
      <h3>Respaldos</h3>
      <div className="panel row">
        <span className="dim" style={{ flex: 1 }}>El servidor guarda una copia de la base de datos cada día y al cerrar cada noche (se conservan 30).</span>
        <button onClick={async () => { try { const r = await api('backup', {}); setMsg(`Respaldo guardado en ${r.file}`); } catch (x) { setMsg(x.message); } }}>Respaldar ahora</button>
      </div>
    </>
  );
}

function Log() {
  const [rows, , err] = useApi('log', 5000);
  const [check, setCheck] = useState(null);
  if (!rows) return <Empty err={err} />;
  return (
    <>
      <Head title="Bitácora" sub="Cada evento lleva el hash del anterior; si alguien edita uno, la cadena se rompe">
        <button onClick={async () => setCheck(await api('verify'))}>Verificar cadena</button>
      </Head>
      {check && <p className={check.ok ? 'note good' : 'note bad'}>{check.ok ? `Íntegra: ${check.checked} eventos verificados` : `Alterada en el evento #${check.brokenAt}`}</p>}
      <Table cols={['#', 'Hora', 'Evento', 'Detalle', 'Hash']} rows={rows.map((e) => [
        e.id, time(e.at), <span className="tag">{e.type}</span>, <Detail type={e.type} d={JSON.parse(e.data)} />, <code className="dim">{e.hash.slice(0, 10)}</code>,
      ])} />
    </>
  );
}

function Detail({ type, d }) {
  if (type === 'mano') return `${d.game === 'holdem' ? "Hold'em · " : ''}Máq ${d.machine} · ${d.card} · apostó ${money(d.bet)} · recibió ${money(d.payout)}`;
  if (type === 'recarga' || type === 'cobro' || type === 'correccion') return `${d.uid} · ${money(d.amount)}`;
  if (type === 'turno-abre' || type === 'turno-cierra') return `Turno #${d.id} · ${d.cashier}${d.efectivo != null ? ` · efectivo ${money(d.efectivo)}` : ''}`;
  if (type === 'reparte') return `Máq ${d.machine} · ${d.card} · ${money(d.bet)}`;
  return <span className="dim">{JSON.stringify(d).slice(0, 90)}</span>;
}

const Head = ({ title, sub, children }) => (
  <div className="head"><div><h1>{title}</h1>{sub && <p className="dim">{sub}</p>}</div><div>{children}</div></div>
);
const Kpi = ({ label, value, tone }) => <div className="kpi"><small>{label}</small><b className={tone}>{value}</b></div>;
const Dot = ({ on }) => <span className={'dot' + (on ? ' on' : '')}>{on ? 'En línea' : 'Apagada'}</span>;
const Field = ({ label, children }) => <label className="field"><span>{label}</span>{children}</label>;
const Empty = ({ err }) => <p className={err ? 'note bad' : 'dim'}>{err || 'Cargando…'}</p>;

function Table({ cols, rows, empty }) {
  if (!rows.length && empty) return <div className="panel dim">{empty}</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
