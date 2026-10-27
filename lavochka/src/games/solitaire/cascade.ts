/* Победа в пасьянсе — каскад, как в старой «Косынке»: карты по одной слетают с баз, прыгают по столу и оставляют
 * за собой след. Холст поверх сцены; щелчок или клавиша — остановить. */
import { cardUrl, deckImage, deckStyle } from '../../cards/render';
import type { Card } from '../../cards/deck';

export interface Launch {
  card: Card;
  /** Центр карты на сцене и её размер. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Спрятать карту на столе, когда она слетает. */
  hide: () => void;
}

/** Запустить каскад. Возвращает «стоп»; onEnd — когда кончились карты или остановили. */
export function cascade(over: HTMLElement, W: number, H: number, cards: Launch[], onEnd: () => void): () => void {
  const cv = document.createElement('canvas');
  cv.className = 'so-cascade';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  Object.assign(cv.style, { position: 'absolute', left: '0', top: '0', width: W + 'px', height: H + 'px', zIndex: '50' });
  over.appendChild(cv);
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);
  const st = deckStyle();
  let k = 0;
  let cur: { im: HTMLImageElement | undefined; c: Launch; x: number; y: number; vx: number; vy: number } | null = null;
  let raf = 0;
  let done = false;
  const launch = () => {
    const c = cards[k++];
    if (!c) return false;
    c.hide();
    const dir = Math.random() < 0.5 ? -1 : 1;
    cur = { im: deckImage(cardUrl(c.card, st)), c, x: c.x, y: c.y, vx: dir * (2.5 + Math.random() * 4.5), vy: -(Math.random() * 9) };
    return true;
  };
  const stop = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('pointerdown', stop, true);
    window.removeEventListener('keydown', stop, true);
    cv.remove();
    onEnd();
  };
  const frame = () => {
    if (done) return;
    // за кадр — два шага физики: след гуще, полёт быстрее
    for (let n = 0; n < 2 && cur; n++) {
      const p = cur;
      p.vy += 0.42;
      p.x += p.vx;
      p.y += p.vy;
      const bottom = H - p.c.h / 2;
      if (p.y > bottom) {
        p.y = bottom;
        p.vy = -p.vy * 0.72;
      }
      if (p.im?.complete) g.drawImage(p.im, p.x - p.c.w / 2, p.y - p.c.h / 2, p.c.w, p.c.h);
      else {
        g.fillStyle = '#fff';
        g.strokeStyle = '#333';
        g.fillRect(p.x - p.c.w / 2, p.y - p.c.h / 2, p.c.w, p.c.h);
        g.strokeRect(p.x - p.c.w / 2, p.y - p.c.h / 2, p.c.w, p.c.h);
      }
      if (p.x < -p.c.w || p.x > W + p.c.w) cur = null;
    }
    if (!cur && !launch()) {
      // все слетели — подержать картину и убрать
      raf = 0;
      setTimeout(stop, 1800);
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  // щелчок или клавиша — хватит (не сразу: тот же щелчок мог закончить пасьянс)
  setTimeout(() => {
    if (done) return;
    window.addEventListener('pointerdown', stop, true);
    window.addEventListener('keydown', stop, true);
  }, 400);
  if (launch()) raf = requestAnimationFrame(frame);
  else stop();
  return stop;
}
