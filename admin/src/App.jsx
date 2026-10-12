import { useCallback, useEffect, useState } from 'react';
import { api, getSession, setSession, lastServer, money, pct, time } from './api.js';

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
      <h3>Máquinas</h3>
      <Table cols={['Máquina', 'Estado', 'Jugador', 'Saldo', 'Manos', 'Ganancia casa', '']} rows={s.machines.map((m) => [
        m.name, <Dot on={m.online} />, m.card_uid ? (m.card_name || m.card_uid) : <span className="dim">Libre</span>,
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
      time(m.at), <span className="tag">Mano</span>, `${m.machine || 'Máquina'} · apostó ${money(m.bet)}`,
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

function Rules() {
  const [s, load, err] = useApi('settings', 0);
  const [form, setForm] = useState(null);
  const [sim, setSim] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (s) setForm({ ...s.rules, targetPct: s.targetPct, minBet: s.limits.minBet / 100, maxBet: s.limits.maxBet / 100, adminPin: '' }); }, [s]);
  if (!form) return <Empty err={err} />;
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try {
      await api('settings', { rules: { decks: +form.decks, bjPays: form.bjPays, dealerHitsSoft17: form.dealerHitsSoft17 === true || form.dealerHitsSoft17 === 'true', winCommissionPct: +form.winCommissionPct },
        targetPct: +form.targetPct, limits: { minBet: +form.minBet, maxBet: +form.maxBet }, adminPin: form.adminPin || undefined });
      if (form.adminPin) setSession({ ...getSession(), pin: form.adminPin });
      setSim(null); setMsg('Guardado. Las máquinas usan las reglas nuevas desde la siguiente mano.'); load();
    } catch (x) { setMsg(x.message); }
  };
  const simulate = async () => { setBusy(true); try { setSim(await api('simulate', {})); } catch (x) { setMsg(x.message); } setBusy(false); };

  return (
    <>
      <Head title="Reglas" sub="Iguales para todas las máquinas y todos los jugadores" />
      <form className="panel form" onSubmit={save}>
        <Field label="Barajas"><select value={form.decks} onChange={f('decks')}>{[1, 2, 4, 6, 8].map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Blackjack paga"><select value={form.bjPays} onChange={f('bjPays')}>{['3:2', '6:5', '1:1'].map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Crupier con 17 suave"><select value={String(form.dealerHitsSoft17)} onChange={f('dealerHitsSoft17')}>
          <option value="true">Pide carta</option><option value="false">Se planta</option></select></Field>
        <Field label="Comisión sobre ganancias %"><input type="number" min="0" max="50" step="0.5" value={form.winCommissionPct} onChange={f('winCommissionPct')} /></Field>
        <Field label="Meta de retención %"><input type="number" min="0" max="50" value={form.targetPct} onChange={f('targetPct')} /></Field>
        <Field label="Apuesta mínima $"><input type="number" min="1" value={form.minBet} onChange={f('minBet')} /></Field>
        <Field label="Apuesta máxima $"><input type="number" min="1" value={form.maxBet} onChange={f('maxBet')} /></Field>
        <Field label="Nuevo PIN admin"><input type="password" value={form.adminPin} onChange={f('adminPin')} placeholder="Dejar vacío para no cambiar" /></Field>
        <div className="row"><button className="primary">Guardar</button>{msg && <span className="note">{msg}</span>}</div>
      </form>

      <h3>Simulador</h3>
      <div className="panel">
        <p className="dim">Juega 100,000 manos con las reglas guardadas y calcula cuánto retiene la casa de lo apostado.</p>
        <button onClick={simulate} disabled={busy}>{busy ? 'Simulando…' : 'Simular'}</button>
        {sim && <Table cols={['Tipo de jugador', 'Ventaja por reglas', 'Retención esperada', `Comisión para llegar a ${pct(s.targetPct)}`]} rows={[
          ['Experto (estrategia básica)', pct(sim.basica.ventajaReglasPct), pct(sim.basica.retencionPct), `≈ ${sim.basica.comisionParaMeta}%`],
          ['Casual (pide hasta 17)', pct(sim.casual.ventajaReglasPct), pct(sim.casual.retencionPct), `≈ ${sim.casual.comisionParaMeta}%`],
        ]} />}
      </div>

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
  if (type === 'mano') return `Máq ${d.machine} · ${d.card} · apostó ${money(d.bet)} · recibió ${money(d.payout)}`;
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
