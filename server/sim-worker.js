// Corre el simulador fuera del hilo principal para no frenar a las máquinas.
import { parentPort, workerData } from 'node:worker_threads';

const { simulate } = await import(workerData.game === 'holdem' ? './holdem-sim.js' : './sim.js');
const s = simulate(workerData.rules);
parentPort.postMessage(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, {
  ventajaReglasPct: v.ventajaReglasPct,
  retencionPct: v.retencionPct,
  comisionParaMeta: v.comisionParaMeta(workerData.targetPct),
}])));
