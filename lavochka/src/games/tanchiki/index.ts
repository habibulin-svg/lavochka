/* Танчики — экран аркады: поле на canvas из сгенерированных картинок (art.ts: танки с двумя кадрами гусениц, кирпич кусками,
 * бетон, вода в три кадра, лёд, кусты поверх танков, база, бонусы, взрывы), справа — запас врагов, жизни, флажок уровня.
 * Один игрок — стрелки или WASD, огонь — пробел; вдвоём за клавиатурой — WASD + пробел и стрелки + Enter. На телефоне — крестовина и кнопка.
 * Конструктор: рисуйте свою карту и играйте её. Пауза сохраняет партию. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { audioOut, click, Sound, tone } from '../../core/audio';
import { store } from '../../core/settings';
import { h } from '../../core/util';
import { BASE_X, BASE_Y, FW, mapRows, N4, N8, newGame, parseMap, step, totalScore, ENEMY_PTS, type Bonus, type Tank, type TkEvent, type TkIn, type TkState } from './logic';
import { art, loadArt, tile, tinted, TANKS, type ArtName } from './art';
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

/** Броневик по запасу брони (4 → 1): тон поверх серой картинки. */
const ARMOR_TINT = ['#b8e0a0', '#ffe080', '#ffb080', '#ffffff'];

interface Boom {
  x: number;
  y: number;
  t: number;
  dur: number;
  size: number;
  rot: number;
}

const EMPTY = Array.from({ length: 26 }, () => '.'.repeat(26));

class Game {
  private el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private st: TkState;
  private stat: HTMLCanvasElement = document.createElement('canvas');
  private walls: HTMLCanvasElement = document.createElement('canvas');
  private booms: Boom[] = [];
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
    void loadArt().then(() => (this.statDirty = true));
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
    const boom = (x: number, y: number, size: number, dur: number) => this.booms.push({ x, y, t: 0, dur, size, rot: Math.random() * Math.PI * 2 });
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
        boom(e.x, e.y, 9, 0.25);
        if (o) click(t, { freq: 500, q: 1, dur: 0.06, gain: 0.35 });
        break;
      case 'steel':
        this.statDirty = true;
        burst(e.x, e.y, 6, ['#ffffff', '#c8d8ff'], 50, 0.8);
        boom(e.x, e.y, 7, 0.2);
        if (o) tone(t, { freq: 1800, to: 1200, dur: 0.08, gain: 0.12, type: 'triangle' });
        break;
      case 'hit':
        burst(e.x, e.y, 6, ['#ffe08a', '#ffffff'], 50, 0.8);
        boom(e.x, e.y, 8, 0.2);
        if (o) tone(t, { freq: 1400, to: 900, dur: 0.06, gain: 0.12, type: 'square' });
        break;
      case 'boom':
        burst(e.x, e.y, e.big ? 14 : 6, ['#ffd23a', '#ff8a2a', '#5a5a5a'], e.big ? 60 : 40, 1.2);
        boom(e.x, e.y, e.kind === -2 ? 40 : e.big ? 30 : 16, e.big ? 0.8 : 0.4);
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

  // ---------------------------------------------------------------- отрисовка (картинки — art.ts)

  /** Неподвижное: земля, лёд, стены с тенью, база — перерисовывается, только когда что-то выбили. */
  private drawStatic() {
    const st = this.st;
    const c = this.stat;
    const W = Math.round(FW * this.s);
    if (c.width !== W) {
      c.width = c.height = W;
      this.walls.width = this.walls.height = W;
      this.statDirty = true;
    }
    if (!this.statDirty) return;
    this.statDirty = false;
    const g = c.getContext('2d')!;
    g.setTransform(this.s, 0, 0, this.s, 0, 0);
    g.clearRect(0, 0, FW, FW);
    const ground = art('ground');
    if (ground) g.drawImage(ground, 0, 0, FW, FW);
    else {
      g.fillStyle = '#25282a';
      g.fillRect(0, 0, FW, FW);
    }
    const m = st.map;
    const ice = art('ice');
    if (ice) for (let y = 0; y < N8; y++) for (let x = 0; x < N8; x++) if (m.ice[y * N8 + x]) tile(g, ice, x * 8, y * 8, 8, 8);
    // стены — на свой слой, потом на землю с тенью
    const wg = this.walls.getContext('2d')!;
    wg.setTransform(this.s, 0, 0, this.s, 0, 0);
    wg.clearRect(0, 0, FW, FW);
    const brick = art('brick');
    if (brick) for (let y = 0; y < N4; y++) for (let x = 0; x < N4; x++) if (m.brick[y * N4 + x]) tile(wg, brick, x * 4, y * 4, 4, 4);
    const steel = art('steel');
    if (steel) for (let y = 0; y < N8; y++) for (let x = 0; x < N8; x++) if (m.steel[y * N8 + x]) wg.drawImage(steel, x * 8, y * 8, 8, 8);
    const base = art(st.baseDead ? 'base-ruin' : 'base');
    if (base) wg.drawImage(base, BASE_X - 1, BASE_Y - 1, 18, 18);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowOffsetX = 0.9 * this.s;
    g.shadowOffsetY = 1.2 * this.s;
    g.shadowBlur = 1.5 * this.s;
    g.drawImage(this.walls, 0, 0);
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
    // фон вокруг поля — полигон, картинкой «под обрез», чуть притушен
    const bg = art('bg');
    if (bg) {
      const k = Math.max(w / bg.naturalWidth, hh / bg.naturalHeight);
      g.drawImage(bg, (w - bg.naturalWidth * k) / 2, (hh - bg.naturalHeight * k) / 2, bg.naturalWidth * k, bg.naturalHeight * k);
      g.fillStyle = 'rgba(10,12,8,0.35)';
      g.fillRect(0, 0, w, hh);
    } else {
      g.fillStyle = '#2a2d1e';
      g.fillRect(0, 0, w, hh);
    }
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
    // рамка поля: тёмная подложка с тенью
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.7)';
    g.shadowBlur = 14 * s;
    g.fillStyle = '#111';
    g.fillRect(this.ox - 2 * s, this.oy - 2 * s, (FW + 4) * s, (FW + 4) * s);
    g.restore();
    g.drawImage(this.stat, this.ox + sx, this.oy + sy);
    g.setTransform(s, 0, 0, s, this.ox + sx, this.oy + sy);
    const st = this.st;
    // вода: три кадра по кругу
    const water = art(`water-${Math.floor(this.time * 2.5) % 3}` as ArtName);
    if (water) for (let y = 0; y < N8; y++) for (let x = 0; x < N8; x++) if (st.map.water[y * N8 + x]) tile(g, water, x * 8, y * 8, 8, 8);
    // бонус
    if (st.bonus) this.drawBonus(g, st.bonus);
    // танки
    if (!this.build) for (const t of st.tanks) this.drawTank(g, t);
    // снаряды
    const shell = art('shell');
    for (const b of st.bullets) {
      g.save();
      g.translate(b.x + 2, b.y + 2);
      g.rotate((b.dir * Math.PI) / 2);
      g.shadowColor = b.pl >= 0 ? '#ffd23a' : '#ff6a4a';
      g.shadowBlur = 5 * s;
      if (shell) g.drawImage(shell, -1.9, -4, 3.8, 8);
      g.restore();
    }
    // кроны поверх танков
    for (let y = 0; y < N8; y++)
      for (let x = 0; x < N8; x++) {
        if (!st.map.trees[y * N8 + x]) continue;
        const hsh = (x * 7919 + y * 104729) >>> 0;
        const bush = art(`bush-${hsh % 3}` as ArtName);
        if (!bush) continue;
        g.save();
        g.translate(x * 8 + 4, y * 8 + 4);
        g.rotate(((hsh >> 3) % 4) * (Math.PI / 2));
        g.shadowColor = 'rgba(0,0,0,0.45)';
        g.shadowOffsetX = 0.8 * s;
        g.shadowOffsetY = 1 * s;
        g.shadowBlur = 1.5 * s;
        g.drawImage(bush, -5.5, -5.5, 11, 11);
        g.restore();
      }
    // взрывы: вспышка → огненный шар → дым
    for (const b of this.booms) {
      if (!this.paused) b.t += dt;
      const p = b.t / b.dur;
      if (p >= 1) continue;
      const fr = p < 0.25 ? 0 : p < 0.6 ? 1 : 2;
      const im = art(`boom-${fr}` as ArtName);
      if (!im) continue;
      const sz = b.size * (0.55 + 0.6 * Math.min(1, p * 2.2));
      g.save();
      g.globalAlpha = fr === 2 ? Math.max(0, 1 - (p - 0.6) / 0.4) : 1;
      if (fr < 2) g.globalCompositeOperation = 'lighter';
      g.translate(b.x, b.y);
      g.rotate(b.rot);
      g.drawImage(im, -sz / 2, -sz / 2, sz, sz);
      g.restore();
    }
    this.booms = this.booms.filter((b) => b.t < b.dur);
    // осколки
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
      g.fillStyle = 'rgba(20,22,18,0.82)';
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
        p.kills.forEach((k, kind) => {
          this.icon(g, `enemy-${kind}` as ArtName, x - 34, 86 + kind * 16, 12);
          this.text(g, `${k} × ${ENEMY_PTS[kind]}`, x + 6, 92 + kind * 16, 7, '#c8d8ff');
        });
      });
    } else if (st.phase === 'over') {
      const k = Math.min(1, (200 - st.phaseT) / 60);
      this.text(g, 'КОНЕЦ ИГРЫ', FW / 2, FW - k * (FW / 2 + 10), 14, '#ff4a3a');
    }
    // правая панель: запас врагов, жизни, уровень
    g.setTransform(s, 0, 0, s, this.ox + (FW + 10) * s, this.oy);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath();
    g.roundRect(-4, -4, 30, FW + 8, 4);
    g.fill();
    const left = Math.max(0, st.queue.length - st.sent);
    for (let i = 0; i < left; i++) this.icon(g, 'enemy-0', (i % 2) * 11, Math.floor(i / 2) * 10, 9);
    st.players.forEach((p, i) => {
      const y = 110 + i * 26;
      this.text(g, i ? 'II' : 'I', 11, y, 8, '#ffffff', 'center');
      this.icon(g, i ? 'tank-p2' : 'tank-p1', 0, y + 4, 10);
      this.text(g, String(Math.max(0, p.lives - (st.tanks.some((t) => t.pl === i) ? 1 : 0))), 13, y + 9, 8, '#ffffff', 'left');
    });
    this.icon(g, 'flag', 0, 166, 18);
    this.text(g, st.custom ? '—' : String(st.stage), 11, 194, 9, '#ffffff');
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

  /** Значок панели: первый кадр картинки (у танков — стоящий), вписан в квадрат size. */
  private icon(g: CanvasRenderingContext2D, n: ArtName, x: number, y: number, size: number) {
    const im = art(n);
    if (!im) return;
    const fw = (TANKS as readonly string[]).includes(n) ? im.naturalHeight : im.naturalWidth;
    g.drawImage(im, 0, 0, fw, im.naturalHeight, x, y, size, size);
  }

  private drawBonus(g: CanvasRenderingContext2D, b: Bonus) {
    const im = art(`bonus-${b.kind}` as ArtName);
    if (!im) return;
    const on = Math.floor(this.time * 4) % 2 === 0;
    g.save();
    g.globalAlpha = on ? 1 : 0.45;
    g.shadowColor = '#fff6c0';
    g.shadowBlur = (on ? 8 : 3) * this.s;
    const k = 1 + 0.06 * Math.sin(this.time * 8);
    g.translate(b.x + 8, b.y + 8);
    g.scale(k, k);
    g.drawImage(im, -8, -8, 16, 16);
    g.restore();
  }

  private drawTank(g: CanvasRenderingContext2D, t: Tank) {
    const cx = t.x + 8;
    const cy = t.y + 8;
    if (t.spawn > 0) {
      // появление: мерцающая звезда
      const sp = art('spawn');
      if (!sp) return;
      const k = (Math.sin(this.time * 18) + 1) / 2;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.translate(cx, cy);
      g.rotate(this.time * 3);
      const sz = 10 + k * 10;
      g.drawImage(sp, -sz / 2, -sz / 2, sz, sz);
      g.restore();
      return;
    }
    const name: ArtName = t.pl === 0 ? 'tank-p1' : t.pl === 1 ? 'tank-p2' : (`enemy-${t.kind}` as ArtName);
    const base = art(name);
    if (!base) return;
    const fh = base.naturalHeight;
    let im: CanvasImageSource | null = base;
    if (t.bonus && Math.floor(this.time * 8) % 2 === 0) im = tinted(name, '#ff6a50');
    else if (t.pl < 0 && t.kind === 3) im = tinted(name, ARMOR_TINT[Math.max(0, Math.min(3, t.hp - 1))]);
    if (!im) return;
    const frame = t.moving ? Math.floor(t.tread / 3) % 2 : 0;
    g.save();
    g.translate(cx, cy);
    g.rotate((t.dir * Math.PI) / 2);
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowOffsetX = 1.2 * this.s;
    g.shadowOffsetY = 1.6 * this.s;
    g.shadowBlur = 2 * this.s;
    if (t.stun > 0 && Math.floor(this.time * 10) % 2) g.globalAlpha = 0.45;
    g.drawImage(im, frame * fh, 0, fh, fh, -10, -10, 20, 20); // картинка со стволом: корпус ~14 единиц
    g.restore();
    // звёзды прокачки — у кормы
    if (t.pl >= 0 && t.star > 0) {
      const star = art('bonus-star');
      if (star) for (let i = 0; i < t.star; i++) g.drawImage(star, t.x + 1 + i * 4, t.y + 14, 3.5, 3.5);
    }
    if (t.shield > 0) {
      g.save();
      const a = 0.35 + 0.25 * Math.sin(this.time * 20);
      const gr = g.createRadialGradient(cx, cy, 6, cx, cy, 11);
      gr.addColorStop(0, 'rgba(120,220,255,0)');
      gr.addColorStop(0.8, `rgba(150,230,255,${a})`);
      gr.addColorStop(1, 'rgba(150,230,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, cy, 11, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
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
    this.booms = [{ x: 48, y: 90, t: 0.42, dur: 1, size: 30, rot: 0.5 }];
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
    { id: 'one', label: 'Один игрок', hint: 'двадцать врагов на уровень' },
    { id: 'two', label: 'Вдвоём', hint: 'за одной клавиатурой' },
    { id: 'build', label: 'Конструктор', hint: 'нарисуй свою карту' },
  ],
  soloHome: true,
  rules: `<h3>Цель</h3><p>Внизу поля — ваша база, красная звезда. Сверху выезжают двадцать вражеских танков, не больше четырёх разом (вдвоём — шести).
    Подбейте всех — уровень пройден. Попадание по базе или потеря всех жизней — конец игры.</p>
    <h3>Местность</h3><ul><li><b>Кирпич</b> выбивается выстрелами по кусочку — можно пробить проход.</li>
    <li><b>Бетон</b> держит снаряды; пробивает его только танк с тремя звёздами.</li>
    <li><b>Вода</b> — не переехать, но снаряды летят над ней.</li><li><b>Лес</b> прячет танки, ездить и стрелять сквозь него можно.</li>
    <li><b>Лёд</b> — танк заносит, он скользит после остановки.</li></ul>
    <h3>Враги</h3><ul><li><b>Обычный</b> — 100 очков.</li><li><b>Быстрый</b> — ездит вдвое резвее, 200 очков.</li>
    <li><b>Скорострел</b> — быстрые снаряды, 300 очков.</li><li><b>Броневик</b> — выдерживает четыре попадания (меняет цвет), 400 очков.</li></ul>
    <h3>Бонусы</h3><p>Мигающий красным враг несёт бонус: подбейте его — на поле появится значок, наезжайте на него.</p>
    <ul><li><b>Каска</b> — щит, снаряды не берут.</li><li><b>Часы</b> — враги замирают.</li><li><b>Лопата</b> — бетонная стена вокруг базы на время.</li>
    <li><b>Звезда</b> — прокачка: быстрые снаряды, два снаряда разом, на третьей — пробивает бетон.</li>
    <li><b>Граната</b> — взрываются все враги на поле.</li><li><b>Танк</b> — лишняя жизнь.</li></ul>
    <h3>Вдвоём</h3><p>Играют вместе за одной клавиатурой. Попал в напарника — он замрёт на пару секунд.</p>
    <h3>Конструктор</h3><p>Рисуйте карту мышью или пальцем кистями «кирпич, бетон, вода, лес, лёд», потом «Играть эту карту».</p>`,
  thumb(el) {
    el.style.cssText = 'position:fixed;inset:0;z-index:50;background:#2a2d1e';
    const g = new Game(el, { mode: 'one', onScore: () => {} });
    (el.querySelector('.tk-wrap') as HTMLElement).style.cssText = 'height:100%;border-radius:0';
    g.demo();
  },
  mount(root, opts) {
    return new Game(root, opts);
  },
};

export default mod;
