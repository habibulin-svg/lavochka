/* Корпус «Электроники»: экран из сегментов, четыре большие кнопки по бокам, «ИГРА А», «ИГРА Б», «ВРЕМЯ».
 * В ожидании показывает часы; «ИГРА А/Б» — начать. Игра идёт тиками (темп задаёт логика), писк — пьезо.
 * Клавиатура: кнопки слева — Q / A (или ← ↑ / ↓ с Shift), справа — P / L (→); 1 / 2 — игра А / Б. */
import { Sound } from '../core/audio';
import type { ArcadeInstance, ArcadeModule, ArcadeOpts } from '../core/arcade';
import { digitSegs, litDigits, type LcdLogic, type LcdSpec } from './lcd-core';
import './lcd.css';

const NS = 'http://www.w3.org/2000/svg';

export function lcdModule(spec: LcdSpec, about: string, controls: string): ArcadeModule {
  return {
    kind: 'arcade',
    id: spec.id,
    title: spec.title,
    about,
    controls,
    modes: spec.modes,
    mount: (root, opts) => mountLcd(spec, root, opts),
  };
}

function mountLcd(spec: LcdSpec, root: HTMLElement, opts: ArcadeOpts): ArcadeInstance {
  const segs = { ...digitSegs(spec.digits.x, spec.digits.y, spec.digits.size), ...spec.segs };
  const b = spec.body;
  const btn = (side: 'left' | 'right', row: 0 | 1) => spec.buttons.find((x) => x.side === side && x.row === row);
  const btnHtml = (side: 'left' | 'right', row: 0 | 1) => {
    const x = btn(side, row);
    return x ? `<button class="lcd-big" data-b="${x.id}" title="${x.keys.join(' / ')}"><span>${x.label}</span></button>` : '<div class="lcd-big-gap"></div>';
  };
  const wrap = document.createElement('div');
  wrap.className = 'lcd-device';
  wrap.style.setProperty('--body', b.color);
  wrap.style.setProperty('--dark', b.dark);
  wrap.style.setProperty('--trim', b.trim);
  wrap.style.setProperty('--label', b.label);
  wrap.innerHTML = `
    <div class="lcd-brand">ЭЛЕКТРОНИКА</div>
    <div class="lcd-face">
      <div class="lcd-col">${btnHtml('left', 0)}${btnHtml('left', 1)}</div>
      <div class="lcd-bezel">
        <svg class="lcd-screen" xmlns="${NS}" viewBox="0 0 ${spec.w} ${spec.h}">
          <rect width="${spec.w}" height="${spec.h}" class="lcd-bg"/>
          <g class="lcd-art">${spec.art}</g>
          <g class="lcd-segs">${Object.entries(segs).map(([id, m]) => `<g data-s="${id}">${m}</g>`).join('')}</g>
          <rect width="${spec.w}" height="${spec.h}" class="lcd-glass"/>
        </svg>
        <div class="lcd-model">${spec.model} «${spec.title.toUpperCase()}»</div>
      </div>
      <div class="lcd-col">
        <div class="lcd-small">${spec.modes.map((m) => `<button data-mode="${m.id}">${m.label}</button>`).join('')}<button data-time="1">ВРЕМЯ</button></div>
        ${btnHtml('right', 0)}${btnHtml('right', 1)}
      </div>
    </div>`;
  root.appendChild(wrap);
  const els = new Map<string, Element>();
  wrap.querySelectorAll('[data-s]').forEach((el) => els.set((el as HTMLElement).dataset.s!, el));

  let logic: LcdLogic | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let clock: ReturnType<typeof setInterval> | undefined;
  let blink = 0;
  let current = opts.mode;
  const lit = new Set<string>();

  const paint = () => {
    for (const [id, el] of els) el.classList.toggle('on', lit.has(id));
  };

  const showClock = () => {
    lit.clear();
    const d = new Date();
    litDigits(`${d.getHours()}`.padStart(2, ' ') + `${d.getMinutes()}`.padStart(2, '0'), lit, d.getSeconds() % 2 === 0);
    paint();
  };

  const idle = () => {
    clearTimeout(timer);
    logic = null;
    showClock();
    clearInterval(clock);
    clock = setInterval(showClock, 1000);
  };

  const frame = () => {
    if (!logic) return;
    lit.clear();
    logic.lit(lit);
    litDigits(String(logic.score), lit);
    paint();
  };

  const loop = () => {
    if (!logic) return;
    const beeps = logic.tick();
    for (const f of beeps) Sound.beep(f, 0.04);
    frame();
    if (logic.over) {
      Sound.beep(400, 0.3);
      const score = logic.score;
      // мигает счёт, потом — часы
      blink = 0;
      const flash = () => {
        if (!logic) return;
        blink++;
        lit.clear();
        logic.lit(lit);
        if (blink % 2) litDigits(String(score), lit);
        paint();
        if (blink < 8) timer = setTimeout(flash, 300);
        else idle();
      };
      timer = setTimeout(flash, 300);
      opts.onScore(score);
      return;
    }
    timer = setTimeout(loop, logic.interval());
  };

  const start = (mode: string) => {
    clearInterval(clock);
    clearTimeout(timer);
    Sound.unlock();
    current = mode;
    logic = spec.create(mode, (Math.random() * 2 ** 31) | 0);
    frame();
    Sound.beep(1500, 0.08);
    timer = setTimeout(loop, 700);
  };

  const press = (id: string) => {
    if (!logic || logic.over) return;
    logic.press(id);
    frame();
  };

  // кнопки
  wrap.querySelectorAll<HTMLButtonElement>('[data-b]').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.classList.add('down');
      press(el.dataset.b!);
    });
    const up = () => el.classList.remove('down');
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
  });
  wrap.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((el) => (el.onclick = () => start(el.dataset.mode!)));
  (wrap.querySelector('[data-time]') as HTMLButtonElement).onclick = () => idle();

  const keymap = new Map<string, string>();
  for (const x of spec.buttons) for (const k of x.keys) keymap.set(k.toLowerCase(), x.id);
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    const modeKey = spec.modes.findIndex((_, i) => k === String(i + 1));
    if (modeKey >= 0) return start(spec.modes[modeKey].id);
    if (k === ' ' && !logic) return start(current);
    const id = keymap.get(k) ?? keymap.get(e.code.toLowerCase());
    if (!id) return;
    e.preventDefault();
    const el = wrap.querySelector(`[data-b="${id}"]`);
    el?.classList.add('down');
    setTimeout(() => el?.classList.remove('down'), 120);
    press(id);
  };
  document.addEventListener('keydown', onKey);
  idle();

  return {
    destroy() {
      clearTimeout(timer);
      clearInterval(clock);
      document.removeEventListener('keydown', onKey);
      wrap.remove();
    },
  };
}
