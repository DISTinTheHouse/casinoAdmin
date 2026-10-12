// Toda la lógica vive en el servidor; la máquina solo muestra y manda jugadas.
import { signedFetch, sha256Hex } from './sign.js';

const KEY = 'bj.machine';
export const getConfig = () => JSON.parse(localStorage.getItem(KEY) || 'null');
export const setConfig = (c) => (c ? localStorage.setItem(KEY, JSON.stringify(c)) : localStorage.removeItem(KEY));

export async function api(path, body, cfg = getConfig()) {
  let res;
  try {
    res = await signedFetch(cfg.server.replace(/\/$/, ''), `/api/m/${path}`, {
      key: sha256Hex(cfg.token).slice(0, 16), secret: cfg.token, body: path === 'state' ? undefined : body || {},
    });
  } catch {
    throw new Error('Sin conexión con el servidor');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

export const money = (cents) =>
  '$' + (cents / 100).toLocaleString('es-MX', cents % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});
