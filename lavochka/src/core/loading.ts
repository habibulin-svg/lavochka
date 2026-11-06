/* Экран загрузки (просьба пользователя 2026-11-06: «прогружается по частям, лучше экран загрузки»).
 * Закрывает экран, пока игра грузит картинки сцены, и уходит, когда всё на месте — без мелькания по частям.
 * Появляется с задержкой: если всё уже в кэше, его не видно вовсе. Общий для «Героев» и ГОПС. */

export interface LoadingOptions {
  /** Картинка во весь экран (под затемнением). */
  art?: string;
  /** Подпись над полосой. */
  title?: string;
  /** Шрифт и цвет подписи — под стиль игры. */
  font?: string;
  color?: string;
}

export interface Loading {
  /** Всё загружено: экран плавно уходит. */
  done(): void;
}

const CSS = `
.ld-screen { position: fixed; inset: 0; z-index: 60; background: #0b0907 center / cover no-repeat; display: flex; flex-direction: column;
  align-items: center; justify-content: flex-end; padding-bottom: 12vh; gap: 14px; opacity: 0; transition: opacity 0.25s; }
.ld-screen::before { content: ''; position: absolute; inset: 0; background: linear-gradient(#0000 40%, #000c); }
.ld-screen.on { opacity: 1; }
.ld-screen > * { position: relative; }
.ld-title { font-size: clamp(20px, 3vw, 32px); text-shadow: 0 2px 0 #000, 0 0 18px #000; letter-spacing: 0.04em; }
.ld-bar { width: min(420px, 70vw); height: 10px; border-radius: 5px; background: #0009; border: 1px solid #fff3; overflow: hidden; }
.ld-bar i { display: block; height: 100%; width: 35%; border-radius: 5px; background: linear-gradient(90deg, #e8b04a, #ffe08a, #e8b04a);
  animation: ld-run 1.1s ease-in-out infinite alternate; }
@keyframes ld-run { from { transform: translateX(-10%); } to { transform: translateX(200%); } }
`;

let styled = false;

export function showLoading(o: LoadingOptions = {}): Loading {
  if (!styled) {
    styled = true;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.append(st);
  }
  const el = document.createElement('div');
  el.className = 'ld-screen';
  if (o.art) el.style.backgroundImage = `url(${o.art})`;
  const title = document.createElement('div');
  title.className = 'ld-title';
  title.textContent = o.title ?? 'Загрузка…';
  title.style.font = o.font ? `400 clamp(20px, 3vw, 32px) ${o.font}` : '';
  title.style.color = o.color ?? '#ffe08a';
  const bar = document.createElement('div');
  bar.className = 'ld-bar';
  bar.append(document.createElement('i'));
  el.append(title, bar);
  document.body.append(el);
  // быстрые загрузки (всё в кэше) — без вспышки
  const show = window.setTimeout(() => el.classList.add('on'), 120);
  let over = false;
  return {
    done() {
      if (over) return;
      over = true;
      window.clearTimeout(show);
      if (!el.classList.contains('on')) return el.remove();
      el.classList.remove('on');
      window.setTimeout(() => el.remove(), 260);
    },
  };
}

/** Загрузить картинки (DOM) до показа: ошибки не мешают — экран всё равно откроется. */
export function preloadImages(urls: string[]): Promise<void> {
  return Promise.all(urls.map((u) => {
    const img = new Image();
    img.src = u;
    return img.decode().catch(() => {});
  })).then(() => {});
}
