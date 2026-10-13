// Actualizaciones desde el servidor de caja. Solo funciona dentro de la app instalada (en el navegador no hace nada).
import { useCallback, useEffect, useState } from 'react';

const tauri = () => window.__TAURI__?.core;
const url = (server, app) => `${server.replace(/\/$/, '')}/api/update/${app}/{{current_version}}`;

// Revisa al abrir y cada 15 minutos. Devuelve la versión nueva (o null) y una función para instalarla.
export default function useUpdate(server, app) {
  const [version, setVersion] = useState(null);
  const [state, setState] = useState(''); // '' | 'installing' | mensaje de error
  useEffect(() => {
    if (!server || !tauri()) return;
    const check = () => tauri().invoke('buscar_actualizacion', { url: url(server, app) }).then(setVersion, () => {});
    check();
    const t = setInterval(check, 900000);
    return () => clearInterval(t);
  }, [server, app]);
  const install = useCallback(async () => {
    setState('installing');
    try { await tauri().invoke('instalar_actualizacion', { url: url(server, app) }); }
    catch (e) { setState(`No se pudo actualizar: ${e}`); }
  }, [server, app]);
  return { version, state, install };
}
