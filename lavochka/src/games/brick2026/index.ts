/* Brick Game 2026 — одиночная аркада: «тип A» (марафон с выбранного уровня до проигрыша) и «тип B» (снять 25 рядов
 * поверх мусора высотой 0…5). Справа — следующая фигура, очки, ряды, уровень и рекорд; слева — сколько каких фигур выпало.
 * Управление — как на приставке: ←/→ (автоповтор), ↓ мягко, X/↑ и Z — поворот; по желанию — тень и мгновенный сброс пробелом.
 * На телефоне — экранные кнопки. Три мелодии на выбор и «без музыки». Пауза сохраняет партию. Сеть — «Битва до 16» (def.ts). */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { audioOut, click, Sound, tone } from '../../core/audio';
import { store } from '../../core/settings';
import { h } from '../../core/util';
import { drawBackdrop, drawBoard, drawPreview, glowText } from './render';
import { H, HIDDEN, KINDS, newTet, stepTet, type Tet, type TetEvent, type TetIn, W } from './tetris';
import './brick2026.css';

const P = {
  level: 'brick2026.level',
  height: 'brick2026.height',
  ghost: 'brick2026.ghost',
  hard: 'brick2026.hard',
  music: 'brick2026.music',
  save: (m: string) => `brick2026.save.${m}`,
  best: (m: string) => `brick2026.best.${m}`,
};

export const MUSIC = [
  { id: 'a', label: 'А' },
  { id: 'b', label: 'Б' },
  { id: 'c', label: 'В' },
  { id: 'off', label: 'нет' },
];

/** Музыка: один трек по кругу; выбор запоминается (общий с сетевой игрой). */
export class Music {
  private a: HTMLAudioElement | null = null;
  private id = '';
  choice = () => store.get<string>(P.music, 'a');
  set(id: string) {
    store.set(P.music, id);
    this.play(true);
  }
  play(on: boolean) {
    const id = this.choice();
    if (!on || id === 'off') {
      this.a?.pause();
      return;
    }
    if (this.id !== id) {
      this.a?.pause();
      this.a = new Audio(`/brick2026/music/${id}.ogg`);
      this.a.loop = true;
      this.a.volume = 0.3;
      this.id = id;
    }
    if (this.a?.paused) void this.a.play().catch(() => {});
  }
  stop() {
    this.a?.pause();
    this.a = null;
    this.id = '';
  }
}

/** Звуки — общие с сетевой игрой. */
export function sfx(e: TetEvent | { k: 'attack' } | { k: 'ko' }) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  switch (e.k) {
    case 'move':
      click(t, { freq: 2400, q: 6, dur: 0.012, gain: 0.12 });
      break;
    case 'rotate':
      tone(t, { freq: 660, to: 880, dur: 0.04, gain: 0.07, type: 'square' });
      break;
    case 'lock':
      click(t, { freq: 500, q: 1.5, dur: 0.05, gain: 0.35 });
      tone(t, { freq: 110, to: 70, dur: 0.06, gain: 0.2 });
      break;
    case 'clear':
      if (e.n === 4) [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone(t + i * 0.05, { freq: f, dur: 0.12, gain: 0.12, type: 'square' }));
      else tone(t, { freq: 300, to: 1200 + e.n * 300, dur: 0.25, gain: 0.12, type: 'sawtooth' });
      break;
    case 'level':
      [784, 988, 1175, 1568].forEach((f, i) => tone(t + i * 0.07, { freq: f, dur: 0.1, gain: 0.1, type: 'triangle' }));
      break;
    case 'garbage':
      tone(t, { freq: 90, to: 50, dur: 0.25, gain: 0.3, type: 'square' });
      break;
    case 'attack':
      tone(t, { freq: 400, to: 1400, dur: 0.18, gain: 0.08, type: 'sawtooth' });
      break;
    case 'ko':
      [1046, 1318, 1568, 2093].forEach((f, i) => tone(t + i * 0.06, { freq: f, dur: 0.12, gain: 0.12, type: 'square' }));
      break;
    case 'over':
      [392, 330, 262, 196].forEach((f, i) => tone(t + i * 0.16, { freq: f, dur: 0.2, gain: 0.14, type: 'square' }));
      break;
    case 'won':
      [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(t + i * 0.1, { freq: f, dur: 0.14, gain: 0.13, type: 'square' }));
      break;
  }
}

/** Клавиши и экранные кнопки → ввод кадра (нажатия поворота — однократные). */
export class Controls {
  keys = new Set<string>();
  private edge = new Set<string>();
  private off: (() => void)[] = [];
  constructor(onAny?: () => void) {
    const KNOWN = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'KeyX', 'KeyZ', 'KeyK', 'KeyJ', 'KeyA', 'KeyD', 'KeyS', 'KeyW', 'Space'];
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea') || !KNOWN.includes(e.code)) return;
      e.preventDefault();
      Sound.unlock();
      onAny?.();
      if (!this.keys.has(e.code)) this.edge.add(e.code);
      this.keys.add(e.code);
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    this.off.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    });
  }
  /** Экранная кнопка: держит «клавишу», пока палец на ней. */
  pad(el: HTMLElement, onAny?: () => void) {
    el.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => {
      const code = b.dataset.k!;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        Sound.unlock();
        onAny?.();
        if (!this.keys.has(code)) this.edge.add(code);
        this.keys.add(code);
        b.setPointerCapture?.(e.pointerId);
      };
      const up = () => this.keys.delete(code);
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
  }
  read(): TetIn {
    const k = this.keys;
    const e = this.edge;
    const inp: TetIn = {
      l: k.has('ArrowLeft') || k.has('KeyA'),
      r: k.has('ArrowRight') || k.has('KeyD'),
      d: k.has('ArrowDown') || k.has('KeyS'),
      cw: e.has('KeyX') || e.has('ArrowUp') || e.has('KeyK') || e.has('KeyW'),
      ccw: e.has('KeyZ') || e.has('KeyJ'),
      drop: e.has('Space'),
    };
    e.clear();
    return inp;
  }
  clear() {
    this.keys.clear();
    this.edge.clear();
  }
  destroy() {
    this.off.forEach((f) => f());
  }
}

export const PAD_HTML = `<div class="bg-pad">
  <div class="bg-pad-l"><button data-k="ArrowLeft">◀</button><button data-k="ArrowDown">▼</button><button data-k="ArrowRight">▶</button></div>
  <div class="bg-pad-r"><button data-k="Space" class="bg-drop">⤓</button><button data-k="KeyZ">↺</button><button data-k="KeyX" class="bg-rot">↻</button></div>
</div>`;

class Game {
  private el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private t: Tet;
  private ctl: Controls;
  private music = new Music();
  private raf = 0;
  private last = 0;
  private acc = 0;
  private time = 0;
  private paused = false;
  private flashT = 0;
  private flashText = '';
  private sideEls: HTMLElement | null = null;
  resumed = false;

  constructor(
    root: HTMLElement,
    private opts: ArcadeOpts
  ) {
    this.el = h(`<div class="bg-wrap"><canvas class="bg-cv"></canvas>${PAD_HTML}</div>`);
    root.appendChild(this.el);
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    const saved = store.get<Tet | null>(P.save(opts.mode), null);
    if (saved && !saved.over && !saved.won && Array.isArray(saved.grid)) {
      this.t = saved;
      this.resumed = true;
    } else this.t = this.fresh();
    this.ctl = new Controls(() => this.music.play(!this.paused && !this.t.over));
    this.ctl.pad(this.el.querySelector('.bg-pad') as HTMLElement, () => this.music.play(!this.paused && !this.t.over));
    this.panel();
    this.raf = requestAnimationFrame((x) => this.frame(x));
  }

  private fresh(): Tet {
    const lvl = store.get<number>(P.level, 0);
    const b = this.opts.mode === 'b';
    return newTet((Math.random() * 2 ** 31) >>> 0, lvl, { goal: b ? 25 : 0, height: b ? store.get<number>(P.height, 0) : 0, hard: store.get<boolean>(P.hard, false) });
  }

  launch() {
    store.set(P.save(this.opts.mode), null);
    this.t = this.fresh();
    this.ctl.clear();
    this.music.play(true);
  }

  private panel() {
    const p = this.opts.panel;
    if (!p) return;
    const seg = (title: string, vals: [string, string][], cur: () => string, set: (v: string) => void) => {
      const row = h(`<div class="bg-row"><span>${title}</span><div class="seg"></div></div>`);
      const s = row.querySelector('.seg') as HTMLElement;
      const sync = () => s.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === cur()));
      for (const [v, l] of vals) {
        const b = h<HTMLButtonElement>(`<button data-v="${v}">${l}</button>`);
        b.onclick = () => {
          set(v);
          sync();
          b.blur();
        };
        s.appendChild(b);
      }
      sync();
      return row;
    };
    const box = h('<div class="bg-panel"></div>');
    box.appendChild(seg('Уровень', Array.from({ length: 20 }, (_, i) => [String(i), String(i)] as [string, string]), () => String(store.get<number>(P.level, 0)), (v) => store.set(P.level, Number(v))));
    if (this.opts.mode === 'b') box.appendChild(seg('Мусор', Array.from({ length: 6 }, (_, i) => [String(i), String(i)] as [string, string]), () => String(store.get<number>(P.height, 0)), (v) => store.set(P.height, Number(v))));
    box.appendChild(seg('Музыка', MUSIC.map((m) => [m.id, m.label] as [string, string]), () => this.music.choice(), (v) => this.music.set(v)));
    box.appendChild(seg('Тень', [['1', 'да'], ['0', 'нет']], () => (store.get<boolean>(P.ghost, true) ? '1' : '0'), (v) => store.set(P.ghost, v === '1')));
    box.appendChild(
      seg('Сброс пробелом', [['1', 'да'], ['0', 'нет']], () => (store.get<boolean>(P.hard, false) ? '1' : '0'), (v) => {
        store.set(P.hard, v === '1');
        this.t.hard = v === '1';
      })
    );
    const go = h<HTMLButtonElement>(`<button class="btn primary">▶ Новая игра</button>`);
    go.onclick = () => {
      this.launch();
      go.blur();
    };
    box.appendChild(go);
    p.appendChild(box);
    this.sideEls = box;
  }

  pause(on: boolean) {
    this.paused = on;
    this.ctl.clear();
    if (on) store.set(P.save(this.opts.mode), this.t.over || this.t.won ? null : this.t);
    this.music.play(!on && !this.t.over);
  }

  private frame(now: number) {
    this.raf = requestAnimationFrame((x) => this.frame(x));
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    this.time += dt;
    if (!this.paused && !document.hidden) {
      this.acc += dt;
      const STEP = 1 / 60;
      let n = 0;
      while (this.acc >= STEP && n < 6) {
        this.acc -= STEP;
        n++;
        const was = this.t.over || this.t.won;
        const ev = stepTet(this.t, this.ctl.read());
        for (const e of ev) {
          sfx(e);
          if (e.k === 'clear' && e.n === 4) this.flash('ЧЕТЫРЕ!');
          if (e.k === 'level') this.flash(`УРОВЕНЬ ${e.level}`);
        }
        if (!was && (this.t.over || this.t.won)) this.finish();
      }
      if (n >= 6) this.acc = 0;
    }
    this.render(dt);
  }

  private flash(s: string) {
    this.flashText = s;
    this.flashT = 1.2;
  }

  private finish() {
    store.set(P.save(this.opts.mode), null);
    const best = store.get<number>(P.best(this.opts.mode), 0);
    if (this.t.score > best) store.set(P.best(this.opts.mode), this.t.score);
    this.music.play(false);
    this.opts.onScore(this.t.score);
  }

  private render(dt: number) {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(60, Math.round(r.width * dpr));
    const hh = Math.max(60, Math.round(r.height * dpr));
    if (this.cv.width !== w || this.cv.height !== hh) {
      this.cv.width = w;
      this.cv.height = hh;
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    drawBackdrop(g, w, hh, this.time);
    // раскладка: логический лист 620×640, поле по центру
    const LW = 620;
    const LH = 640;
    const s = Math.min(w / LW, hh / LH);
    g.setTransform(s, 0, 0, s, (w - LW * s) / 2, (hh - LH * s) / 2);
    const t = this.t;
    const c = 28;
    const bx = 170;
    const by = 50;
    drawBoard(g, t, bx, by, c, {
      ghost: store.get<boolean>(P.ghost, true),
      clearRows: t.clearRows,
      clearK: t.clearRows.length ? 1 - t.clearT / 18 : 0,
      dead: t.over,
    });
    // справа: следующая, очки, ряды, уровень
    const rx = bx + W * c + 28;
    this.panelBox(g, rx, by, 130, 110, 'СЛЕДУЮЩАЯ');
    drawPreview(g, t.next, rx + 65, by + 64, 24, t.level);
    this.panelBox(g, rx, by + 130, 130, 80, 'ОЧКИ');
    glowText(g, String(t.score).padStart(7, '0'), rx + 65, by + 182, 22, '#ffd23a', 'center');
    this.panelBox(g, rx, by + 230, 130, 80, this.opts.mode === 'b' ? 'ОСТАЛОСЬ' : 'РЯДЫ');
    glowText(g, String(this.opts.mode === 'b' ? t.goal : t.lines).padStart(3, '0'), rx + 65, by + 282, 26, '#3affd8', 'center');
    this.panelBox(g, rx, by + 330, 130, 80, 'УРОВЕНЬ');
    glowText(g, String(t.level).padStart(2, '0'), rx + 65, by + 382, 26, '#ff6ad8', 'center');
    this.panelBox(g, rx, by + 430, 130, 80, 'РЕКОРД');
    glowText(g, String(Math.max(t.score, store.get<number>(P.best(this.opts.mode), 0))).padStart(7, '0'), rx + 65, by + 482, 20, '#ffffff', 'center');
    // слева: статистика фигур
    const lx = 14;
    this.panelBox(g, lx, by, 130, 470, 'ФИГУРЫ');
    KINDS.forEach((_, i) => {
      const y = by + 70 + i * 60;
      drawPreview(g, i + 1, lx + 42, y, 13, t.level);
      glowText(g, String(t.stats[i]).padStart(3, '0'), lx + 112, y, 18, '#ff8a8a', 'right');
    });
    glowText(g, `ЧЕТЫРЕ: ${t.tetrises}`, lx + 65, by + 500, 14, '#ffd23a', 'center');
    // надписи
    if (this.flashT > 0) {
      this.flashT -= dt;
      g.globalAlpha = Math.min(1, this.flashT * 2);
      glowText(g, this.flashText, bx + (W * c) / 2, by + 200, 30, '#ffffff', 'center');
      g.globalAlpha = 1;
    }
    if (t.over || t.won) {
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(bx, by + 180, W * c, 150);
      glowText(g, t.won ? 'ГОТОВО!' : 'ИГРА ОКОНЧЕНА', bx + (W * c) / 2, by + 225, 26, t.won ? '#3aff8a' : '#ff5a5a', 'center');
      glowText(g, String(t.score), bx + (W * c) / 2, by + 265, 24, '#ffd23a', 'center');
      glowText(g, '«Новая игра» — ещё раз', bx + (W * c) / 2, by + 300, 13, '#c8d8ff', 'center');
    }
    void H;
    void HIDDEN;
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  private panelBox(g: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, title: string) {
    g.fillStyle = 'rgba(6,8,28,0.82)';
    g.strokeStyle = '#3a6aff';
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(x, y, w, hh, 8);
    g.fill();
    g.stroke();
    glowText(g, title, x + w / 2, y + 16, 12, '#8ab4ff', 'center');
  }

  destroy() {
    if (!this.t.over && !this.t.won) store.set(P.save(this.opts.mode), this.t);
    cancelAnimationFrame(this.raf);
    this.ctl.destroy();
    this.music.stop();
    this.sideEls?.remove();
    this.el.remove();
  }
}

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'brick2026',
  title: 'Brick Game 2026',
  about: 'Падающие фигуры как на старой приставке: та же скорость, тот же счёт, — но в яркой современной графике. Тип A, тип B и битва до шестнадцати по сети.',
  controls: `<p><kbd>←</kbd> <kbd>→</kbd> — сдвиг (держите — побежит), <kbd>↓</kbd> — быстрее вниз, <kbd>X</kbd> или <kbd>↑</kbd> — поворот по часовой, <kbd>Z</kbd> — против.
    Мгновенный сброс <kbd>Пробел</kbd> — если включён в панели (на приставке его не было). На телефоне — кнопки под полем.</p>
    <p><b>Тип A</b> — играйте, пока стакан не переполнится; каждые 10 рядов — следующий уровень, фигуры падают быстрее. <b>Тип B</b> — снять 25 рядов поверх мусора.
    Очки: ряд — 40, два — 100, три — 300, четыре сразу — 1200, всё умноженное на (уровень + 1).</p>`,
  modes: [
    { id: 'a', label: 'Тип A', hint: 'марафон' },
    { id: 'b', label: 'Тип B', hint: '25 рядов' },
  ],
  net: { label: 'Битва до 16', hint: 'каждый сам за себя: мусорные ряды соперникам, по сети или с ботами', load: () => import('./net').then((m) => m.default) },
  mount(root, opts) {
    return new Game(root, opts);
  },
};

export default mod;
