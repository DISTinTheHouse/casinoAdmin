import { useEffect, useRef } from 'react';

// Los lectores NFC USB en modo teclado "escriben" el número de la tarjeta muy rápido y terminan con Enter.
export default function useCardReader(onCard) {
  const cb = useRef(onCard);
  cb.current = onCard;
  useEffect(() => {
    let buf = '', last = 0;
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const t = performance.now();
      if (t - last > 80) buf = '';
      last = t;
      if (e.key === 'Enter') {
        if (buf.length >= 4) cb.current(buf);
        buf = '';
      } else if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
