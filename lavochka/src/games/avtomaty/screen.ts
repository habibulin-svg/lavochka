/* Общая оболочка автоматов «15 копеек»: экран на всю область стола (кабинет не рисуем), в углу — полупрозрачный
 * монетоприёмник с настоящей монетой 15 коп., на телефоне — полупрозрачная ручка и кнопки поверх экрана, справа —
 * карточка с монетами. Клавиатуру каждая игра слушает сама; касания приходят через onInput. */
import type { ArcadeOpts } from '../../core/arcade';
import { esc } from '../../core/util';
import { coinMode, DAILY, pocket, setCoinMode, type CoinMode } from './coins';
import './screen.css';

export type Dir = 'left' | 'right' | 'up' | 'down';

export interface ShellSpec {
  /** Класс для своего оформления экрана (avs--crt, avs--scope…). */
  cls: string;
  /** Ширина к высоте экрана. */
  aspect: number;
  /** Что показать в карточке справа (HTML), кнопки и т. п. — после монет. */
  info: string;
  /** Ручка на телефоне: во все стороны, только четыре направления, только влево-вправо, нет. */
  pad?: 'xy' | '4' | 'x' | null;
  /** Кнопки на телефоне (справа внизу): id и надпись. */
  buttons?: { id: string; label: string; big?: boolean }[];
  onCoin(): void;
  onInput?(k: Dir | string, down: boolean): void;
}

export interface Shell {
  wrap: HTMLElement;
  /** Экран — сюда игра кладёт свой canvas. */
  screen: HTMLElement;
  info: HTMLElement;
  say(text: string, ms?: number): void;
  /** Монета провалилась в щель (анимация). */
  drop(): void;
  drawPocket(): void;
  /** Подсветить кнопку на телефоне (нажата клавишей). */
  lit(id: string, on: boolean): void;
  destroy(): void;
}

const capture = (el: HTMLElement, e: PointerEvent) => {
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* палец уже отпущен */
  }
};

export const COIN_IMG = `${import.meta.env.BASE_URL}avtomaty/coin15.webp`;

export function mountShell(root: HTMLElement, opts: ArcadeOpts | undefined, spec: ShellSpec): Shell {
  const wrap = document.createElement('div');
  wrap.className = `avs ${spec.cls}`;
  wrap.style.setProperty('--ar', String(spec.aspect));
  const base = `${import.meta.env.BASE_URL}avtomaty/cab/`;
  const pad = spec.pad ? `<div class="avs-pad avs-pad--${spec.pad}"><i class="avs-knob"></i></div>` : '';
  const btns = (spec.buttons ?? [])
    .map((b) => `<button class="avs-tb${b.big ? ' big' : ''}" data-tb="${esc(b.id)}"><span>${esc(b.label)}</span></button>`)
    .join('');
  wrap.innerHTML = `<div class="avs-screen"></div>
    <button class="avs-coin" title="Бросить монету 15 коп.: пробел"><img class="avs-mech" alt="" src="${base}coinmech.webp"><img class="avs-drop" alt="" src="${COIN_IMG}"></button>
    <div class="avs-touch">${pad}<div class="avs-btns">${btns}</div></div>
    <div class="avs-msg" hidden></div>`;
  root.appendChild(wrap);
  const q = <T extends HTMLElement>(s: string) => wrap.querySelector(s) as T;
  const screen = q('.avs-screen');
  const msg = q('.avs-msg');
  const coinBtn = q<HTMLButtonElement>('.avs-coin');
  coinBtn.addEventListener('click', () => {
    coinBtn.blur();
    spec.onCoin();
  });

  // ---- карточка справа: режим монет и карман
  const info = document.createElement('div');
  info.className = 'avt-info';
  info.innerHTML = `${spec.info}
    <div class="seg avt-mode">
      <button data-m="strict" title="Рубль на день — шесть монет; кончились — приходите завтра">Строго: рубль в день</button>
      <button data-m="free" title="Монета всегда найдётся">Бесконечные монетки</button>
    </div>
    <div class="avt-pocket"></div>`;
  opts?.panel?.appendChild(info);
  const pocketEl = info.querySelector('.avt-pocket') as HTMLElement;
  const coins = (n: number, gone = 0) =>
    `<span class="avt-coins">${Array.from({ length: n }, (_, i) => `<img alt="" src="${COIN_IMG}" class="${i < n - gone ? '' : 'gone'}">`).join('')}</span>`;
  const drawPocket = () => {
    const p = pocket();
    info.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === coinMode()));
    pocketEl.innerHTML =
      coinMode() === 'strict'
        ? `${coins(DAILY, DAILY - p.left)} ${p.left ? `В кармане ${p.left} × 15 коп.` : 'Монеты кончились — приходите завтра.'}`
        : `${coins(3)} Монет сколько угодно. Сегодня брошено: ${p.played}.`;
  };
  info.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => {
    b.onclick = () => {
      b.blur();
      setCoinMode(b.dataset.m as CoinMode);
      drawPocket();
    };
  });
  drawPocket();

  let msgTimer = 0;
  const say = (text: string, ms = 2400) => {
    msg.textContent = text;
    msg.hidden = !text;
    clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => (msg.hidden = true), ms);
  };

  // ---- ручка на телефоне: направление — по углу от центра круга (у «4» — только главная ось)
  const input = spec.onInput ?? (() => {});
  const padEl = wrap.querySelector('.avs-pad') as HTMLElement | null;
  const dirs = new Set<Dir>();
  const setDirs = (next: Set<Dir>) => {
    for (const d of [...dirs]) if (!next.has(d)) input(d, false);
    for (const d of next) if (!dirs.has(d)) input(d, true);
    dirs.clear();
    next.forEach((d) => dirs.add(d));
  };
  if (padEl) {
    const knob = padEl.querySelector('.avs-knob') as HTMLElement;
    padEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(padEl, e);
      const move = (ev: PointerEvent) => {
        const r = padEl.getBoundingClientRect();
        let dx = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2);
        let dy = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2);
        if (spec.pad === 'x') dy = 0;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          dx /= len;
          dy /= len;
        }
        knob.style.transform = `translate(${dx * 60}%, ${dy * 60}%)`;
        const s = new Set<Dir>();
        if (len > 0.25) {
          const a = Math.atan2(dy, dx); // 0 — вправо, по часовой
          const oct = Math.round(a / (Math.PI / 4)); // −4…4
          const axis = spec.pad === '4' ? Math.round(a / (Math.PI / 2)) * 2 : oct;
          const o = ((axis % 8) + 8) % 8;
          if (o === 7 || o === 0 || o === 1) s.add('right');
          if (o >= 3 && o <= 5) s.add('left');
          if (o >= 1 && o <= 3) s.add('down');
          if (o >= 5 && o <= 7) s.add('up');
        }
        setDirs(s);
      };
      const up = () => {
        padEl.removeEventListener('pointermove', move);
        padEl.removeEventListener('pointerup', up);
        padEl.removeEventListener('pointercancel', up);
        knob.style.transform = '';
        setDirs(new Set());
      };
      move(e);
      padEl.addEventListener('pointermove', move);
      padEl.addEventListener('pointerup', up);
      padEl.addEventListener('pointercancel', up);
    });
  }
  wrap.querySelectorAll<HTMLElement>('[data-tb]').forEach((el) => {
    const id = el.dataset.tb!;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(el, e);
      el.classList.add('down');
      input(id, true);
      const up = () => {
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.classList.remove('down');
        input(id, false);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  wrap.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    wrap,
    screen,
    info,
    say,
    drawPocket,
    drop() {
      coinBtn.classList.remove('drop');
      void coinBtn.offsetWidth;
      coinBtn.classList.add('drop');
    },
    lit(id, on) {
      wrap.querySelector(`[data-tb="${id}"]`)?.classList.toggle('down', on);
    },
    destroy() {
      clearTimeout(msgTimer);
      info.remove();
      wrap.remove();
    },
  };
}
