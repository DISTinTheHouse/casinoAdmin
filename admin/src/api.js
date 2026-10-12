import { signedFetch } from './sign.js';

const KEY = 'bj.admin';
export const getSession = () => JSON.parse(sessionStorage.getItem(KEY) || 'null');
export const setSession = (s) => (s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY));
export const lastServer = () => localStorage.getItem('bj.server') || 'http://localhost:7021';

export async function api(path, body, s = getSession()) {
  let res;
  try {
    res = await signedFetch(s.server.replace(/\/$/, ''), `/api/a/${path}`, { key: 'admin', secret: s.pin, body });
  } catch {
    throw new Error('Sin conexión con el servidor');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

export const money = (cents = 0) =>
  '$' + (cents / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct = (n = 0) => n.toFixed(1) + '%';
export const time = (iso) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
