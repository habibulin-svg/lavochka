/* Танчики — экран аркады: поле на canvas (всё рисуется кодом: кирпич с кладкой, клёпаный бетон, рябь воды, блики льда,
 * кроны поверх танков, танки с бегущими гусеницами, взрывы, искры), справа — запас врагов, жизни, флажок уровня.
 * Один игрок — стрелки или WASD, огонь — пробел; вдвоём за клавиатурой — WASD + пробел и стрелки + Enter. На телефоне — крестовина и кнопка.
 * Конструктор: рисуйте свою карту и играйте её. Пауза сохраняет партию. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { audioOut, click, Sound, tone } from '../../core/audio';
import { store } from '../../core/settings';
import { h } from '../../core/util';
import { BASE_X, BASE_Y, DX, DY, FW, mapRows, N4, N8, newGame, parseMap, step, totalScore, ENEMY_PTS, type Bonus, type Tank, type TkEvent, type TkIn, type TkState } from './logic';
import './tanchiki.css';

const P = {
  diff: 'tanchiki.diff',
  stage: 'tanchiki.stage',
  music: 'tanchiki.music',
  map: 'tanchiki.map',
  save: (m: string) => `tanchiki.save.${m}`,
  best: 'tanchiki.best',
};

const LW = 268;
const LH = 224;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  c: string;
  r: number;
}

interface Popup {
  x: number;
  y: number;
  t: number;
  text: string;
}

const EMPTY = Array.from({ length: 26 }, () => '.'.repeat(26));

class Game {
  private el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private st: TkState;
  private stat: HTMLCanvasElement = document.createElement('canvas');
  private statDirty = true;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private time = 0;
  private paused = false;
  private keys: string[] = [];
  private sparks: Spark[] = [];
  private pops: Popup[] = [];
  private flashT = 0;
  private shake = 0;
  private music: HTMLAudioElement | null = null;
  private musicId = '';
  private off: (() => void)[] = [];
  private build: boolean;
  private brush = '#';
  private painting = false;
  private s = 1;
  private ox = 0;
  private oy = 0;
  private reported = false;
  resumed = false;

  constructor(
    root: HTMLElement,
    private opts: ArcadeOpts
  ) {
    this.build = opts.mode === 'build';
    this.el = h(`<div class="tk-wrap"><canvas class="tk-cv"></canvas>
      <div class="tk-pad"><div class="tk-cross"><button data-k="KeyW">▲</button><button data-k="KeyA">◀</button><button data-k="KeyD">▶</button><button data-k="KeyS">▼</button></div><button class="tk-fire" data-k="Space">●</button></div></div>`);
    root.appendChild(this.el);
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    const saved = this.build ? null : store.get<TkState | null>(P.save(opts.mode), null);
    if (saved && saved.phase !== 'over' && saved.map?.brick) {
      this.st = saved;
      this.resumed = true;
    } else this.st = this.fresh();
    this.panel();
    this.bind();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private fresh(): TkState {
    if (this.build) return newGame({ players: 1, diff: 1, map: store.get<string[]>(P.map, EMPTY) });
    return newGame({ players: this.opts.mode === 'two' ? 2 : 1, diff: store.get<number>(P.diff, 1), stage: store.get<number>(P.stage, 1), seed: 0x7a7c1 });
  }

  // ---------------------------------------------------------------- панель

  private panel() {
    const p = this.opts.panel;
    if (!p) return;
    const box = h('<div class="tk-panel"></div>');
    const seg = (title: string, vals: [string, string][], cur: () => string, set: (v: string) => void) => {
      const row = h(`<div class="tk-row"><span>${title}</span><div class="seg"></div></div>`);
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
    if (this.build) {
      box.appendChild(
        seg('Кисть', [['#', 'кирпич'], ['@', 'бетон'], ['~', 'вода'], ['%', 'лес'], ['-', 'лёд'], ['.', 'стереть']], () => this.brush, (v) => (this.brush = v))
      );
      const row = h(`<div class="tk-row"><button class="btn small" data-a="play">▶ Играть эту карту</button><button class="btn small" data-a="edit">✎ Рисовать</button><button class="btn small" data-a="clear">Очистить</button></div>`);
      (row.querySelector('[data-a=play]') as HTMLButtonElement).onclick = () => {
        store.set(P.map, mapRows(this.st.map));
        this.st = newGame({ players: 1, diff: store.get<number>(P.diff, 1), map: store.get<string[]>(P.map, EMPTY) });
        this.build = false;
        this.statDirty = true;
        this.reported = false;
      };
      (row.querySelector('[data-a=edit]') as HTMLButtonElement).onclick = () => {
        this.build = true;
        this.st = newGame({ players: 1, diff: 1, map: store.get<string[]>(P.map, EMPTY) });
        this.statDirty = true;
      };
      (row.querySelector('[data-a=clear]') as HTMLButtonElement).onclick = () => {
        store.set(P.map, EMPTY);
        this.st = newGame({ players: 1, diff: 1, map: EMPTY });
        this.build = true;
        this.statDirty = true;
      };
      box.appendChild(row);
    } else {
      box.appendChild(seg('Уровень', Array.from({ length: 10 }, (_, i) => [String(i * 5 + 1), String(i * 5 + 1)] as [string, string]), () => String(store.get<number>(P.stage, 1)), (v) => store.set(P.stage, Number(v))));
    }
    box.appendChild(seg('Сложность', [['0', 'лёгкая'], ['1', 'средняя'], ['2', 'трудная']], () => String(store.get<number>(P.diff, 1)), (v) => store.set(P.diff, Number(v))));
    box.appendChild(
      seg('Музыка', [['march', 'марш'], ['battle', 'бой'], ['off', 'нет']], () => store.get<string>(P.music, 'march'), (v) => {
        store.set(P.music, v);
        this.syncMusic();
      })
    );
    if (!this.build) {
      const go = h<HTMLButtonElement>(`<button class="btn primary">▶ Новая игра</button>`);
      go.onclick = () => {
        store.set(P.save(this.opts.mode), null);
        this.st = this.fresh();
        this.statDirty = true;
        this.reported = false;
        this.syncMusic();
        go.blur();
      };
      box.appendChild(go);
    }
    p.appendChild(box);
    this.off.push(() => box.remove());
  }

  private syncMusic() {
    const id = store.get<string>(P.music, 'march');
    const want = !this.paused && !this.build && id !== 'off' && this.st.phase !== 'over';
    if (!want) {
      this.music?.pause();
      return;
    }
    if (this.musicId !== id) {
      this.music?.pause();
      this.music = new Audio(`/tanchiki/music/${id}.ogg`);
      this.music.loop = true;
      this.music.volume = 0.25;
      this.musicId = id;
    }
    if (this.music?.paused) void this.music.play().catch(() => {});
  }

  // ---------------------------------------------------------------- управление

  private bind() {
    const KNOWN = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'NumpadEnter', 'KeyJ', 'KeyF', 'Numpad0', 'ControlRight'];
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea') || !KNOWN.includes(e.code)) return;
      e.preventDefault();
      Sound.unlock();
      this.syncMusic();
      if (!this.keys.includes(e.code)) this.keys.push(e.code);
    };
    const ku = (e: KeyboardEvent) => (this.keys = this.keys.filter((k) => k !== e.code));
    const blur = () => (this.keys = []);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    this.off.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    });
    this.el.querySelectorAll<HTMLElement>('.tk-pad [data-k]').forEach((b) => {
      const code = b.dataset.k!;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        Sound.unlock();
        this.syncMusic();
        if (!this.keys.includes(code)) this.keys.push(code);
        b.setPointerCapture?.(e.pointerId);
      });
      const up = () => (this.keys = this.keys.filter((k) => k !== code));
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
    // конструктор: рисование мышью/пальцем
    const paint = (e: PointerEvent) => {
      if (!this.build || !this.painting) return;
      const r = this.cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const x = ((e.clientX - r.left) * dpr - this.ox) / this.s;
      const y = ((e.clientY - r.top) * dpr - this.oy) / this.s;
      if (x < 0 || y < 0 || x >= FW || y >= FW) return;
      const rows = mapRows(this.st.map);
      const cx = Math.floor(x / 8);
      const cy = Math.floor(y / 8);
      // кисть 2×2 полуклетки (одна клетка) — как в конструкторе приставки
      const bx = cx - (cx % 2);
      const by = cy - (cy % 2);
      for (let yy = by; yy < by + 2; yy++) rows[yy] = rows[yy].slice(0, bx) + this.brush + this.brush + rows[yy].slice(bx + 2);
      this.st.map = parseMap(rows);
      store.set(P.map, mapRows(this.st.map));
      this.statDirty = true;
    };
    this.cv.addEventListener('pointerdown', (e) => {
      this.painting = true;
      this.cv.setPointerCapture?.(e.pointerId);
      paint(e);
    });
    this.cv.addEventListener('pointermove', paint);
    this.cv.addEventListener('pointerup', () => (this.painting = false));
  }

  /** Ввод игрока: последнее нажатое направление из его клавиш. */
  private input(pl: number, two: boolean): TkIn {
    const dirKeys: Record<string, number> = two
      ? pl === 0
        ? { KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 }
        : { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 }
      : { KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3, ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };
    const fireKeys = two ? (pl === 0 ? ['Space', 'KeyF'] : ['Enter', 'NumpadEnter', 'Numpad0', 'ControlRight']) : ['Space', 'Enter', 'KeyJ', 'KeyF'];
    let dir = -1;
    for (let i = this.keys.length - 1; i >= 0; i--)
      if (this.keys[i] in dirKeys) {
        dir = dirKeys[this.keys[i]];
        break;
      }
    return { dir, fire: this.keys.some((k) => fireKeys.includes(k)) };
  }

  pause(on: boolean) {
    this.paused = on;
    this.keys = [];
    if (on && !this.build) store.set(P.save(this.opts.mode), this.st.phase === 'over' || this.st.custom ? null : this.st);
    this.syncMusic();
  }

  // ---------------------------------------------------------------- цикл

  private frame(now: number) {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    this.time += dt;
    if (!this.paused && !document.hidden && !this.build) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= 1 / 60 && n < 5) {
        this.acc -= 1 / 60;
        n++;
        const two = this.st.players.length > 1;
        const ev = step(this.st, [this.input(0, two), this.input(1, two)]);
        for (const e of ev) this.onEvent(e);
        if (this.st.phase === 'over' && !this.reported) {
          this.reported = true;
          store.set(P.save(this.opts.mode), null);
          const sc = totalScore(this.st);
          if (sc > store.get<number>(P.best, 0)) store.set(P.best, sc);
          this.syncMusic();
          if (!this.st.custom) this.opts.onScore(sc);
        }
      }
      if (n >= 5) this.acc = 0;
    }
    this.render(dt);
  }

  private onEvent(e: TkEvent) {
    const o = audioOut();
    const t = o?.ctx.currentTime ?? 0;
    const burst = (x: number, y: number, n: number, cols: string[], sp: number, r = 1.2) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = sp * (0.3 + Math.random());
        this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.3 + Math.random() * 0.5, c: cols[i % cols.length], r });
      }
    };
    switch (e.k) {
      case 'fire':
        if (o) {
          click(t, { freq: 900, q: 1.5, dur: 0.05, gain: 0.3 });
          tone(t, { freq: 220, to: 110, dur: 0.06, gain: 0.12, type: 'square' });
        }
        break;
      case 'brick':
        this.statDirty = true;
        burst(e.x, e.y, 8, ['#c8663a', '#8a3a1a', '#e8a070'], 40);
        if (o) click(t, { freq: 500, q: 1, dur: 0.06, gain: 0.35 });
        break;
      case 'steel':
        this.statDirty = true;
        burst(e.x, e.y, 6, ['#ffffff', '#c8d8ff'], 50, 0.8);
        if (o) tone(t, { freq: 1800, to: 1200, dur: 0.08, gain: 0.12, type: 'triangle' });
        break;
      case 'hit':
        burst(e.x, e.y, 6, ['#ffe08a', '#ffffff'], 50, 0.8);
        if (o) tone(t, { freq: 1400, to: 900, dur: 0.06, gain: 0.12, type: 'square' });
        break;
      case 'boom':
        burst(e.x, e.y, e.big ? 26 : 10, ['#ffd23a', '#ff8a2a', '#ff3a1a', '#5a5a5a'], e.big ? 70 : 40, 1.6);
        this.shake = Math.max(this.shake, e.kind === -2 ? 1 : 0.4);
        this.flashT = e.kind === -2 ? 0.5 : 0.15;
        if (e.pts) this.pops.push({ x: e.x, y: e.y, t: 1.2, text: String(e.pts) });
        this.statDirty = true;
        if (o) {
          click(t, { freq: 200, q: 0.8, dur: 0.35, gain: 0.7 });
          tone(t, { freq: 90, to: 40, dur: 0.4, gain: 0.35, type: 'square' });
        }
        break;
      case 'bonusShow':
        if (o) [880, 1175, 880, 1175].forEach((f, i) => tone(t + i * 0.07, { freq: f, dur: 0.06, gain: 0.1, type: 'square' }));
        break;
      case 'bonus':
        this.pops.push({ x: 104, y: 100, t: 1.4, text: { helmet: 'ЩИТ', clock: 'ЗАМОРОЗКА', shovel: 'БЕТОН У БАЗЫ', star: 'ЗВЕЗДА', grenade: 'ГРАНАТА', tank: '+1 ЖИЗНЬ' }[e.kind] });
        if (e.kind === 'shovel' || e.kind === 'grenade') this.statDirty = true;
        if (o) [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.06, { freq: f, dur: 0.08, gain: 0.12, type: 'square' }));
        break;
      case 'life':
        if (o) [784, 988, 1175, 1568].forEach((f, i) => tone(t + i * 0.08, { freq: f, dur: 0.1, gain: 0.12, type: 'triangle' }));
        break;
      case 'stage':
        this.statDirty = true;
        if (o) [392, 523, 659, 784, 659, 784].forEach((f, i) => tone(t + i * 0.12, { freq: f, dur: 0.12, gain: 0.12, type: 'square' }));
        break;
      case 'base':
      case 'over':
        if (o && e.k === 'over') [392, 330, 262, 196].forEach((f, i) => tone(t + 0.5 + i * 0.2, { freq: f, dur: 0.22, gain: 0.14, type: 'square' }));
        break;
      case 'clear':
        if (o) [523, 659, 784, 1046, 1318].forEach((f, i) => tone(t + i * 0.1, { freq: f, dur: 0.12, gain: 0.12, type: 'square' }));
        break;
    }
  }

  // ---------------------------------------------------------------- отрисовка

  private drawStatic() {
    const st = this.st;
    const c = this.stat;
    const W = Math.round(FW * this.s);
    if (c.width !== W) {
      c.width = c.height = W;
      this.statDirty = true;
    }
    if (!this.statDirty) return;
    this.statDirty = false;
    const g = c.getContext('2d')!;
    g.setTransform(this.s, 0, 0, this.s, 0, 0);
    // земля: тёмный асфальт с крапом
    g.fillStyle = '#1e2326';
    g.fillRect(0, 0, FW, FW);
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.12)';
      g.fillRect(r() * FW, r() * FW, 1 + r() * 2, 1 + r());
    }
    const m = st.map;
    // лёд
    for (let y = 0; y < N8; y++)
      for (let x = 0; x < N8; x++) {
        if (!m.ice[y * N8 + x]) continue;
        g.fillStyle = '#a8d8ee';
        g.fillRect(x * 8, y * 8, 8, 8);
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = 0.6;
        g.beginPath();
        g.moveTo(x * 8 + 1, y * 8 + 6);
        g.lineTo(x * 8 + 5, y * 8 + 2);
        g.stroke();
      }
    // кирпич: кусками 4×4 с кладкой
    for (let y = 0; y < N4; y++)
      for (let x = 0; x < N4; x++) {
        if (!m.brick[y * N4 + x]) continue;
        const px = x * 4;
        const py = y * 4;
        g.fillStyle = '#9a4322';
        g.fillRect(px, py, 4, 4);
        const off = y % 2 ? 2 : 0;
        g.fillStyle = '#c8663a';
        g.fillRect(px + 0.3, py + 0.3, 3.4, 1.5);
        g.fillRect(px + 0.3, py + 2.2, 3.4, 1.5);
        g.fillStyle = '#e8946a';
        g.fillRect(px + 0.3, py + 0.3, 3.4, 0.5);
        g.fillStyle = 'rgba(60,30,20,0.9)';
        g.fillRect(px + off, py, 0.5, 2);
        g.fillRect(px + ((off + 2) % 4), py + 2, 0.5, 2);
      }
    // бетон: клёпаные плиты
    for (let y = 0; y < N8; y++)
      for (let x = 0; x < N8; x++) {
        if (!m.steel[y * N8 + x]) continue;
        const px = x * 8;
        const py = y * 8;
        const gr = g.createLinearGradient(px, py, px + 8, py + 8);
        gr.addColorStop(0, '#e8ecf0');
        gr.addColorStop(0.5, '#a8b0b8');
        gr.addColorStop(1, '#6a727a');
        g.fillStyle = gr;
        g.fillRect(px, py, 8, 8);
        g.fillStyle = '#ffffff';
        g.fillRect(px, py, 8, 0.6);
        g.fillRect(px, py, 0.6, 8);
        g.fillStyle = '#4a5058';
        g.fillRect(px, py + 7.4, 8, 0.6);
        g.fillRect(px + 7.4, py, 0.6, 8);
        g.fillStyle = '#5a6068';
        for (const [rx, ry] of [[2, 2], [6, 2], [2, 6], [6, 6]]) {
          g.beginPath();
          g.arc(px + rx, py + ry, 0.6, 0, Math.PI * 2);
          g.fill();
        }
      }
    // база: звезда на постаменте (или руины)
    this.drawBase(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawBase(g: CanvasRenderingContext2D) {
    const x = BASE_X;
    const y = BASE_Y;
    if (this.st.baseDead) {
      g.fillStyle = '#3a3230';
      g.fillRect(x + 1, y + 6, 14, 10);
      g.fillStyle = '#5a4a40';
      for (const [a, b] of [[3, 8], [8, 10], [11, 7], [5, 12]]) g.fillRect(x + a, y + b, 3, 2);
      return;
    }
    g.fillStyle = '#5a5a62';
    g.fillRect(x + 2, y + 11, 12, 5);
    g.fillStyle = '#8a8a92';
    g.fillRect(x + 2, y + 11, 12, 1);
    g.save();
    g.translate(x + 8, y + 7);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? 2.6 : 6.4;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    const gr = g.createLinearGradient(-6, -6, 6, 6);
    gr.addColorStop(0, '#ff6a5a');
    gr.addColorStop(1, '#a8100a');
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = '#ffd23a';
    g.lineWidth = 0.7;
    g.stroke();
    g.restore();
  }

  private render(dt: number) {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(60, Math.round(r.width * dpr));
    const hh = Math.max(60, Math.round(r.height * dpr));
    if (this.cv.width !== w || this.cv.height !== hh) {
      this.cv.width = w;
      this.cv.height = hh;
      this.statDirty = true;
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, hh);
    bg.addColorStop(0, '#4a4f36');
    bg.addColorStop(1, '#2a2d1e');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, hh);
    const s = Math.min(w / LW, hh / LH);
    if (Math.abs(s - this.s) > 0.001) {
      this.s = s;
      this.statDirty = true;
    }
    this.ox = Math.round((w - LW * s) / 2 + 4 * s);
    this.oy = Math.round((hh - LH * s) / 2 + 8 * s);
    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      sx = (Math.random() - 0.5) * this.shake * 4 * s;
      sy = (Math.random() - 0.5) * this.shake * 4 * s;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    this.drawStatic();
    // рамка поля
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(this.ox - 3 * s, this.oy - 3 * s, (FW + 6) * s, (FW + 6) * s);
    g.drawImage(this.stat, this.ox + sx, this.oy + sy);
    g.setTransform(s, 0, 0, s, this.ox + sx, this.oy + sy);
    const st = this.st;
    // вода (анимированная)
    for (let y = 0; y < N8; y++)
      for (let x = 0; x < N8; x++) {
        if (!st.map.water[y * N8 + x]) continue;
        g.fillStyle = '#1a5ab8';
        g.fillRect(x * 8, y * 8, 8, 8);
        g.strokeStyle = 'rgba(160,210,255,0.7)';
        g.lineWidth = 0.6;
        const ph = this.time * 2 + x * 0.7 + y * 1.3;
        for (let k = 0; k < 2; k++) {
          const yy = y * 8 + 2.5 + k * 4;
          g.beginPath();
          g.moveTo(x * 8, yy + Math.sin(ph + k) * 0.6);
          g.quadraticCurveTo(x * 8 + 4, yy - 1 + Math.sin(ph + k + 1), x * 8 + 8, yy + Math.sin(ph + k + 2) * 0.6);
          g.stroke();
        }
      }
    // бонус
    if (st.bonus && Math.floor(this.time * 4) % 2 === 0) this.drawBonus(g, st.bonus);
    // танки
    if (!this.build) for (const t of st.tanks) this.drawTank(g, t);
    // снаряды
    for (const b of st.bullets) {
      g.save();
      g.shadowColor = b.pl >= 0 ? '#ffd23a' : '#ff6a5a';
      g.shadowBlur = 4 * s;
      g.fillStyle = '#fff4c8';
      const vert = b.dir % 2 === 0;
      g.fillRect(b.x + (vert ? 1 : 0), b.y + (vert ? 0 : 1), vert ? 2 : 4, vert ? 4 : 2);
      g.restore();
    }
    // кроны поверх
    for (let y = 0; y < N8; y++)
      for (let x = 0; x < N8; x++) {
        if (!st.map.trees[y * N8 + x]) continue;
        for (const [ax, ay, rr, c] of [
          [2.5, 2.5, 3.2, '#1f5a24'],
          [6, 3, 2.8, '#2a7030'],
          [3.5, 6, 2.8, '#24642a'],
          [6, 6.5, 2.4, '#1a4a1e'],
          [4.5, 4, 1.4, '#4aa04a'],
        ] as [number, number, number, string][]) {
          g.fillStyle = c;
          g.beginPath();
          g.arc(x * 8 + ax, y * 8 + ay, rr, 0, Math.PI * 2);
          g.fill();
        }
      }
    // искры
    for (const k of this.sparks) {
      k.t -= dt;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.vx *= 0.9;
      k.vy *= 0.9;
      if (k.t <= 0) continue;
      g.globalAlpha = Math.min(1, k.t * 3);
      g.fillStyle = k.c;
      g.fillRect(k.x - k.r / 2, k.y - k.r / 2, k.r, k.r);
    }
    g.globalAlpha = 1;
    this.sparks = this.sparks.filter((k) => k.t > 0);
    for (const p of this.pops) {
      p.t -= dt;
      p.y -= dt * 10;
      g.globalAlpha = Math.min(1, p.t * 2);
      this.text(g, p.text, p.x, p.y, 7, '#ffffff');
    }
    g.globalAlpha = 1;
    this.pops = this.pops.filter((p) => p.t > 0);
    if (this.flashT > 0) {
      g.fillStyle = `rgba(255,220,160,${this.flashT})`;
      g.fillRect(0, 0, FW, FW);
      this.flashT = Math.max(0, this.flashT - dt * 2);
    }
    // заставки
    if (this.build) {
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 0.4;
      for (let i = 0; i <= 13; i++) {
        g.beginPath();
        g.moveTo(i * 16, 0);
        g.lineTo(i * 16, FW);
        g.moveTo(0, i * 16);
        g.lineTo(FW, i * 16);
        g.stroke();
      }
      this.text(g, 'КОНСТРУКТОР: рисуйте мышью или пальцем', FW / 2, 8, 6, '#ffd23a');
    } else if (st.phase === 'intro') {
      g.fillStyle = 'rgba(40,40,40,0.85)';
      g.fillRect(0, 0, FW, FW);
      this.text(g, st.custom ? 'СВОЯ КАРТА' : `УРОВЕНЬ ${st.stage}`, FW / 2, FW / 2, 14, '#ffffff');
    } else if (st.phase === 'tally' || st.phase === 'won') {
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(0, 0, FW, FW);
      this.text(g, st.phase === 'won' ? 'КАРТА ПРОЙДЕНА!' : `УРОВЕНЬ ${st.stage} ПРОЙДЕН`, FW / 2, 30, 11, '#ffd23a');
      st.players.forEach((p, i) => {
        const x = st.players.length > 1 ? (i ? 150 : 58) : FW / 2;
        this.text(g, st.players.length > 1 ? (i ? 'II ИГРОК' : 'I ИГРОК') : 'ОЧКИ', x, 56, 8, '#ff8a6a');
        this.text(g, String(p.score), x, 70, 9, '#ffffff');
        p.kills.forEach((k, kind) => this.text(g, `${k} × ${ENEMY_PTS[kind]}`, x, 92 + kind * 16, 7, '#c8d8ff'));
      });
    } else if (st.phase === 'over') {
      const k = Math.min(1, (200 - st.phaseT) / 60);
      this.text(g, 'КОНЕЦ ИГРЫ', FW / 2, FW - k * (FW / 2 + 10), 14, '#ff4a3a');
    }
    // правая панель: запас врагов, жизни, уровень
    g.setTransform(s, 0, 0, s, this.ox + (FW + 10) * s, this.oy);
    const left = Math.max(0, st.queue.length - st.sent);
    for (let i = 0; i < left; i++) this.miniTank(g, (i % 2) * 10, Math.floor(i / 2) * 9, '#c8ccd0');
    st.players.forEach((p, i) => {
      const y = 110 + i * 26;
      this.text(g, i ? 'II' : 'I', 10, y, 8, '#ffffff', 'left');
      this.miniTank(g, 0, y + 4, i ? '#4ac060' : '#e8c040');
      this.text(g, String(Math.max(0, p.lives - (st.tanks.some((t) => t.pl === i) ? 1 : 0))), 14, y + 9, 8, '#ffffff', 'left');
    });
    // флажок
    g.fillStyle = '#8a8a8a';
    g.fillRect(2, 170, 1.2, 16);
    g.fillStyle = '#e8322a';
    g.beginPath();
    g.moveTo(3.2, 170);
    g.lineTo(14, 174);
    g.lineTo(3.2, 178);
    g.fill();
    this.text(g, st.custom ? '—' : String(st.stage), 10, 194, 9, '#ffffff');
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  private text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = 'center') {
    g.save();
    g.font = `bold ${size}px "PT Sans", Arial, sans-serif`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillText(s, x + 0.5, y + 0.5);
    g.fillStyle = col;
    g.fillText(s, x, y);
    g.restore();
  }

  private miniTank(g: CanvasRenderingContext2D, x: number, y: number, c: string) {
    g.fillStyle = '#2a2a2a';
    g.fillRect(x, y, 7, 7);
    g.fillStyle = c;
    g.fillRect(x + 1.5, y + 1, 4, 5);
    g.fillRect(x + 3, y - 1, 1, 3);
  }

  private drawBonus(g: CanvasRenderingContext2D, b: Bonus) {
    g.save();
    g.shadowColor = '#ffffff';
    g.shadowBlur = 6 * this.s;
    g.fillStyle = 'rgba(30,30,60,0.9)';
    g.beginPath();
    g.roundRect(b.x, b.y, 16, 16, 3);
    g.fill();
    g.restore();
    g.strokeStyle = '#ffd23a';
    g.lineWidth = 0.8;
    g.beginPath();
    g.roundRect(b.x, b.y, 16, 16, 3);
    g.stroke();
    const sym = { helmet: '⛑', clock: '⏱', shovel: '▦', star: '★', grenade: '✸', tank: '♥' }[b.kind];
    this.text(g, sym, b.x + 8, b.y + 8.5, 11, b.kind === 'star' ? '#ffd23a' : b.kind === 'tank' ? '#ff5a5a' : '#ffffff');
  }

  private drawTank(g: CanvasRenderingContext2D, t: Tank) {
    const cx = t.x + 8;
    const cy = t.y + 8;
    if (t.spawn > 0) {
      // появление: мерцающая звезда
      const k = (Math.sin(this.time * 18) + 1) / 2;
      g.save();
      g.translate(cx, cy);
      g.rotate(this.time * 3);
      g.fillStyle = `rgba(255,255,255,${0.5 + k * 0.5})`;
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const rr = i % 2 ? 2 : 4 + k * 4;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.restore();
      return;
    }
    let body: string;
    let dark: string;
    if (t.pl === 0) [body, dark] = ['#e8c040', '#8a6a10'];
    else if (t.pl === 1) [body, dark] = ['#4ac060', '#1a6a2a'];
    else if (t.kind === 3) [body, dark] = [['#a0a8b0', '#c87a40', '#c8a040', '#8aa06a'][t.hp - 1] ?? '#8aa06a', '#3a3a3a'];
    else [body, dark] = [['#a8b0b8', '#d0d8e0', '#7a8a9a'][t.kind], '#3a4048'];
    if (t.bonus && Math.floor(this.time * 8) % 2 === 0) [body, dark] = ['#e8322a', '#6a0a08'];
    g.save();
    g.translate(cx, cy);
    g.rotate((t.dir * Math.PI) / 2);
    // тень
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(-7 + 1.2, -7 + 1.5, 14, 14);
    // гусеницы
    for (const side of [-1, 1]) {
      g.fillStyle = '#1a1a1a';
      g.fillRect(side < 0 ? -7.5 : 4, -7.5, 3.5, 15);
      g.fillStyle = '#5a5a5a';
      const ph = t.moving ? (t.tread * 0.5) % 3 : 0;
      for (let k = -7.5 + ph; k < 7.5; k += 3) g.fillRect(side < 0 ? -7.2 : 4.3, k, 2.9, 1);
    }
    // корпус
    const gr = g.createLinearGradient(-4, -6, 4, 6);
    gr.addColorStop(0, body);
    gr.addColorStop(1, dark);
    g.fillStyle = gr;
    g.fillRect(-4.5, -6, 9, 12);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(-4.5, -6, 9, 1);
    // башня и ствол
    g.fillStyle = dark;
    g.fillRect(-0.9, -9 - (t.kind === 2 && t.pl < 0 ? 1 : 0), 1.8, 7);
    g.fillStyle = body;
    g.beginPath();
    g.arc(0, 0.5, 3.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.beginPath();
    g.arc(-1, -0.6, 1.2, 0, Math.PI * 2);
    g.fill();
    if (t.pl >= 0 && t.star > 0) {
      g.fillStyle = '#ffd23a';
      for (let i = 0; i < t.star; i++) g.fillRect(-3 + i * 2.2, 4, 1.5, 1.5);
    }
    g.restore();
    if (t.shield > 0) {
      g.save();
      g.strokeStyle = `rgba(120,220,255,${0.5 + 0.4 * Math.sin(this.time * 20)})`;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, cy, 10, this.time * 6, this.time * 6 + 4);
      g.stroke();
      g.restore();
    }
    if (t.stun > 0 && Math.floor(this.time * 10) % 2) {
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.fillRect(t.x, t.y, 16, 16);
    }
    void DX;
    void DY;
  }

  /** Превью карточки: бой в разгаре, игра стоит. */
  demo() {
    const st = newGame({ players: 2, diff: 1, stage: 4, seed: 0x7a7c1 });
    st.phase = 'play';
    const mk = (x: number, y: number, dir: 0 | 1 | 2 | 3, pl: number, kind: 0 | 1 | 2 | 3, bonus = false) =>
      st.tanks.push({ id: st.nextId++, x, y, dir, pl, kind, hp: kind === 3 ? 3 : 1, bonus, shield: 0, stun: 0, spawn: 0, star: pl >= 0 ? 2 : 0, slide: 0, tread: 3, moving: true, cool: 0, think: 0, dead: false });
    st.tanks = [];
    mk(72, 150, 0, 0, 0);
    mk(132, 120, 3, 1, 0);
    mk(40, 40, 2, -1, 0);
    mk(150, 56, 2, -1, 3);
    mk(96, 24, 1, -1, 1, true);
    st.bullets = [
      { x: 78, y: 110, dir: 0, speed: 4, owner: st.tanks[0].id, pl: 0, power: false },
      { x: 158, y: 90, dir: 2, speed: 3, owner: st.tanks[3].id, pl: -1, power: false },
    ];
    st.bonus = { kind: 'star', x: 176, y: 144, t: 0 };
    st.sent = 9;
    this.st = st;
    this.statDirty = true;
    this.paused = true;
    this.sparks = [];
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      this.sparks.push({ x: 48 + Math.cos(a) * 6, y: 90 + Math.sin(a) * 6, vx: 0, vy: 0, t: 99, c: ['#ffd23a', '#ff8a2a', '#ff3a1a'][i % 3], r: 2 });
    }
  }

  destroy() {
    if (!this.build && this.st.phase !== 'over' && !this.st.custom) store.set(P.save(this.opts.mode), this.st);
    cancelAnimationFrame(this.raf);
    this.off.forEach((f) => f());
    this.music?.pause();
    this.music = null;
    this.el.remove();
  }
}

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'tanchiki',
  title: 'Танчики',
  about: 'Защити базу: двадцать вражеских танков на уровень, кирпич и бетон, вода, лес и лёд, бонусы. Один или вдвоём, плюс конструктор карт.',
  controls: `<p><b>Один:</b> стрелки или <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> — ехать, <kbd>Пробел</kbd> — огонь.
    <b>Вдвоём:</b> первый — <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> и <kbd>Пробел</kbd>, второй — стрелки и <kbd>Enter</kbd>. На телефоне — крестовина и кнопка огня.</p>
    <p>Кирпич выбивается выстрелами, бетон — только танком с тремя звёздами. Воду не переехать, в лесу прячутся, на льду заносит.
    Мигающий красный враг несёт бонус: каска — щит, часы — враги замирают, «стена» — бетон вокруг базы, звезда — прокачка, взрыв — все враги на поле, сердце — жизнь.
    Свою базу (звезду внизу) береги: попадание по ней — конец игры. Попал в напарника — он замрёт на пару секунд.</p>`,
  modes: [
    { id: 'one', label: 'Один игрок' },
    { id: 'two', label: 'Вдвоём' },
    { id: 'build', label: 'Конструктор' },
  ],
  thumb(el) {
    el.style.cssText = 'position:fixed;inset:0;z-index:50;background:#2a2d1e';
    const g = new Game(el, { mode: 'one', onScore: () => {} });
    g.demo();
  },
  mount(root, opts) {
    return new Game(root, opts);
  },
};

export default mod;
