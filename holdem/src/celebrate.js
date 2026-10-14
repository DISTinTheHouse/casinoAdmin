import { createElement, useEffect, useRef, useState } from 'react';

// Confeti en un canvas sobre toda la pantalla: sale disparado desde las dos esquinas de abajo
// y llueve desde arriba. Con un premio grande hay más y dura más.
const COLORS = ['#f6c453', '#ffe08a', '#ffffff', '#3ddc84', '#ff6b6b', '#4da3ff', '#e09a1a'];

export function Confetti({ big }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current, ctx = cv.getContext('2d');
    const W = (cv.width = innerWidth), H = (cv.height = innerHeight);
    const parts = [];
    const spawn = (x, y, vx, vy) => parts.push({ x, y, vx, vy, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      w: 8 + Math.random() * 8, h: 5 + Math.random() * 6, c: COLORS[(Math.random() * COLORS.length) | 0], wob: Math.random() * 10 });
    const burst = (n) => {
      for (let i = 0; i < n; i++) {
        spawn(0, H, 6 + Math.random() * 10, -(14 + Math.random() * 12));
        spawn(W, H, -(6 + Math.random() * 10), -(14 + Math.random() * 12));
      }
    };
    burst(big ? 160 : 90);
    const rainUntil = performance.now() + (big ? 3500 : 1800);
    const endAt = performance.now() + (big ? 7000 : 5000);
    let raf;
    const tick = (t) => {
      if (t < rainUntil) for (let i = 0; i < (big ? 6 : 3); i++) spawn(Math.random() * W, -20, (Math.random() - 0.5) * 3, 2 + Math.random() * 3);
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.35; p.vx *= 0.99; p.vy = Math.min(p.vy, 6 + p.w / 4);
        p.x += p.vx + Math.sin((t / 200) + p.wob); p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(t / 150 + p.wob)));
        ctx.restore();
      }
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].y > H + 40) parts.splice(i, 1);
      if (t < endAt && (parts.length || t < rainUntil)) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [big]);
  return createElement('canvas', { ref, className: 'confetti' });
}

// El saldo sube contando, como cuando la máquina paga.
export function useCountUp(value, ms = 1400) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const [up, setUp] = useState(false);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (value <= start) { setShown(value); return; }
    setUp(true);
    const t0 = performance.now();
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3;
      setShown(k < 1 ? Math.round((start + (value - start) * e) / 100) * 100 : value); // pesos cerrados mientras cuenta
      if (k < 1) raf = requestAnimationFrame(step);
      else setTimeout(() => setUp(false), 900);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return [shown, up];
}
