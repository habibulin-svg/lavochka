/* «Клад» — экран: карта ста уровней (звёзды, открытые и закрытые) и поле 8×8 — песок, земля, камни, сокровища
 * (монета, рубин, изумруд, сапфир, аметист, жемчуг, перстень), спецфишки (лопата, динамит, самородок).
 * Ход — нажать фишку и соседнюю (или провести пальцем). Анимация: обмен, исчезновение, падение. Прогресс — на этом устройстве. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { Fx, Sprites } from '../../core/arcade-fx';
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { esc, h, sleep } from '../../core/util';
import { Board, levelSpec, N, type Special, type Step, type Tile } from './logic';
import './treasures.css';

const C = 64;
const KEY = 'treasures.progress';

interface Progress {
  open: number;
  best: Record<number, { score: number; stars: number }>;
}

const loadProgress = (): Progress => store.get<Progress>(KEY, { open: 1, best: {} });

/** Картинки (tools/arcade-art): сокровища по виду фишки, спецфишки, клетки, песочница вокруг поля, карта уровней. */
export const GEM = ['gem0', 'gem1', 'gem2', 'gem3', 'gem4', 'gem5', 'gem6'] as const;
export const ART = new Sprites('klad', [...GEM, 'shovel', 'dynamite', 'nugget', 'stone', 'sand', 'dirt', 'bg', 'map'] as const);
/** Цвет осколков по виду: монета, рубин, изумруд, сапфир, аметист, жемчуг, перстень. */
export const CHIP = ['#f0c020', '#e02030', '#20b050', '#2a60e8', '#9a40d8', '#f4f0ec', '#e8a820'];
const chip = (kind: number) => CHIP[kind] ?? '#a0522d';

/** Сетевая игра: поле приходит от стола, ход уходит туда же (карты уровней и итога нет). */
export interface NetHooks {
  onMove(ax: number, ay: number, bx: number, by: number): void;
}

type Pos = { x: number; y: number; a: number };

export class Game {
  private el: HTMLElement;
  private board: Board | null = null;
  private cv!: HTMLCanvasElement;
  private g!: CanvasRenderingContext2D;
  private disp: (number | null)[][] = [];
  private info = new Map<number, Tile>();
  private pos = new Map<number, Pos>();
  private target = new Map<number, { x: number; y: number }>();
  private fading = new Map<number, Pos>();
  private sel: [number, number] | null = null;
  private busy = false;
  private raf = 0;
  private down: { x: number; y: number; cx: number; cy: number } | null = null;
  private hintAt: [number, number, number, number] | null = null;
  private fx = new Fx();
  private last = 0;
  private t = 0;
  /** Сколько стоят без хода (с) — после 8 с подсказка сама. */
  private idle = 0;
  private sandPat: CanvasPattern | null = null;
  private dirtPat: CanvasPattern | null = null;

  constructor(
    root: HTMLElement,
    private opts: ArcadeOpts,
    private net?: NetHooks
  ) {
    this.el = h('<div class="tr-dev"></div>');
    root.appendChild(this.el);
    if (!net) this.showMap();
  }

  /** Сетевая игра: начать на этом поле. */
  netStart(b: Board) {
    this.begin(b, 0);
  }

  /** Сетевая игра: поле пришло от стола (кирпичи, расхождение) — показать как есть. */
  netReset(b: Board) {
    this.board = b;
    this.disp = [];
    this.info.clear();
    this.pos.clear();
    this.target.clear();
    this.fading.clear();
    this.sel = null;
    this.hintAt = null;
    this.sync(true);
  }

  get netBusy() {
    return this.busy;
  }

  get netBoard() {
    return this.board;
  }

  /** Встряхнуть поле и выбить искры в клетках (кирпичи прилетели, камень). */
  netFx(cells: [number, number][], color: string) {
    for (const [x, y] of cells) this.fx.burst(x * C + C / 2, y * C + C / 2, color, 8, 180, 4);
    if (cells.length) this.fx.shake(Math.min(8, 3 + cells.length));
  }

  // ---------------------------------------------------------------- карта уровней

  private showMap() {
    cancelAnimationFrame(this.raf);
    this.board = null;
    const pr = loadProgress();
    let s = `<div class="tr-map" style="--map:url('${ART.url('map')}')"><div class="tr-map-t">Сто кладов — выберите уровень</div><div class="tr-grid">`;
    for (let n = 1; n <= 100; n++) {
      const b = pr.best[n];
      const open = n <= pr.open;
      const sp = levelSpec(n);
      s += `<button class="tr-lv${open ? '' : ' locked'}${sp.goal === 'dirt' ? ' dig' : ''}" data-n="${n}" ${open ? '' : 'disabled'}>
        <b>${n}</b><span>${b ? '★'.repeat(b.stars) + '☆'.repeat(3 - b.stars) : open ? '' : '🔒'}</span></button>`;
    }
    s += '</div></div>';
    this.el.innerHTML = s;
    this.el.querySelectorAll<HTMLButtonElement>('.tr-lv').forEach((b) => (b.onclick = () => this.start(+b.dataset.n!)));
    const cur = this.el.querySelector(`[data-n="${Math.min(100, pr.open)}"]`);
    cur?.scrollIntoView({ block: 'center' });
  }

  // ---------------------------------------------------------------- уровень

  private start(n: number) {
    Sound.ui();
    this.begin(new Board(levelSpec(n)), n);
  }

  private begin(b: Board, n: number) {
    this.board = b;
    const net = !!this.net;
    this.el.innerHTML = `<div class="tr-play">
      ${net ? '' : '<div class="tr-hud"></div>'}
      <div class="tr-box" style="--bg:url('${ART.url('bg')}')"><canvas width="${N * C * 2}" height="${N * C * 2}"></canvas></div>
      <div class="tr-btns">${net ? '' : '<button class="btn" data-b="map">← Уровни</button>'}<button class="btn" data-b="hint">Подсказка</button>${net ? '' : '<button class="btn" data-b="again">Заново</button>'}</div>
    </div>`;
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    this.g.setTransform(2, 0, 0, 2, 0, 0);
    this.fx = new Fx();
    this.fx.gravity = 700;
    this.idle = 0;
    this.sandPat = this.dirtPat = null;
    const btn = (k: string) => this.el.querySelector(`[data-b=${k}]`) as HTMLButtonElement | null;
    if (btn('map')) btn('map')!.onclick = () => this.showMap();
    if (btn('again')) btn('again')!.onclick = () => this.start(n);
    (this.el.querySelector('[data-b=hint]') as HTMLButtonElement).onclick = () => {
      this.hintAt = this.board?.hint() ?? null;
      setTimeout(() => (this.hintAt = null), 1500);
    };
    this.cv.addEventListener('pointerdown', (e) => this.pointer(e, 'down'));
    this.cv.addEventListener('pointermove', (e) => this.pointer(e, 'move'));
    this.cv.addEventListener('pointerup', () => (this.down = null));
    this.sync(true);
    this.hud();
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(50, now - this.last);
      this.last = now;
      this.t += dt / 1000;
      this.fx.update(dt);
      if (!this.busy && this.board && !this.board.won && !this.board.lost && !this.net) {
        this.idle += dt / 1000;
        if (this.idle > 8 && !this.hintAt) this.hintAt = this.board.hint();
      }
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
  }

  /** Отображение = доска (без анимации или с ней). */
  private sync(snap: boolean) {
    const b = this.board!;
    this.disp = b.cells.map((row) => row.map((c) => c.tile?.id ?? null));
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const t = b.cells[y][x].tile;
        if (!t) continue;
        this.info.set(t.id, t);
        this.target.set(t.id, { x, y });
        if (snap || !this.pos.has(t.id)) this.pos.set(t.id, { x, y, a: 1 });
      }
  }

  private hud() {
    const b = this.board;
    if (!b || this.net) return;
    const goal = b.spec.goal === 'dirt' ? `откопать клад: осталось земли <b>${b.dirtLeft}</b>` : `цель: <b>${b.spec.target}</b> очков`;
    (this.el.querySelector('.tr-hud') as HTMLElement).innerHTML = `<span>Уровень <b>${b.spec.n}</b></span><span>ходов <b>${b.moves}</b></span><span>очки <b>${b.score}</b></span><span>${goal}</span><span class="tr-stars">${'★'.repeat(b.stars())}${'☆'.repeat(3 - b.stars())}</span>`;
  }

  private cellAt(e: PointerEvent) {
    const r = this.cv.getBoundingClientRect();
    return { cx: Math.floor(((e.clientX - r.left) / r.width) * N), cy: Math.floor(((e.clientY - r.top) / r.height) * N), x: e.clientX, y: e.clientY };
  }

  private pointer(e: PointerEvent, kind: 'down' | 'move') {
    if (this.busy || !this.board || this.frozen) return;
    const p = this.cellAt(e);
    if (kind === 'down') {
      Sound.unlock();
      this.down = { x: p.x, y: p.y, cx: p.cx, cy: p.cy };
      if (this.sel && Math.abs(this.sel[0] - p.cx) + Math.abs(this.sel[1] - p.cy) === 1) {
        const [ax, ay] = this.sel;
        this.sel = null;
        void this.move(ax, ay, p.cx, p.cy);
        return;
      }
      this.sel = [p.cx, p.cy];
      return;
    }
    // провести пальцем
    if (!this.down) return;
    const dx = p.x - this.down.x;
    const dy = p.y - this.down.y;
    const rect = this.cv.getBoundingClientRect();
    if (Math.hypot(dx, dy) < rect.width / N / 2) return;
    const tx = this.down.cx + (Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0);
    const ty = this.down.cy + (Math.abs(dx) > Math.abs(dy) ? 0 : Math.sign(dy));
    const { cx, cy } = this.down;
    this.down = null;
    this.sel = null;
    void this.move(cx, cy, tx, ty);
  }

  private async move(ax: number, ay: number, bx: number, by: number) {
    const b = this.board!;
    if (bx < 0 || by < 0 || bx >= N || by >= N) return;
    const idA = this.disp[ay][ax];
    const idB = this.disp[by][bx];
    if (idA == null || idB == null) return;
    this.busy = true;
    this.idle = 0;
    this.hintAt = null;
    // показать обмен
    this.target.set(idA, { x: bx, y: by });
    this.target.set(idB, { x: ax, y: ay });
    Sound.place();
    await sleep(160);
    const steps = b.swap(ax, ay, bx, by);
    if (!steps) {
      // нет ряда — обратно
      Sound.nomove();
      this.target.set(idA, { x: ax, y: ay });
      this.target.set(idB, { x: bx, y: by });
      await sleep(160);
      this.busy = false;
      return;
    }
    [this.disp[ay][ax], this.disp[by][bx]] = [idB, idA];
    this.net?.onMove(ax, ay, bx, by);
    for (let i = 0; i < steps.length; i++) await this.playStep(steps[i], i + 1);
    // кирпичи стареют после своего хода (у стола — так же, как в комнате)
    if (this.net && b === this.board) {
      const st = b.ageBricks();
      if (st.length) this.netFx(st, '#8a8178');
    }
    if (b === this.board) this.sync(false);
    this.hud();
    this.busy = false;
    if ((b.won || b.lost) && !this.net) await this.finish();
  }

  private async playStep(st: Step, chain: number) {
    for (const t of st.added) this.info.set(t.id, t);
    // исчезновение: осколки своего цвета, очки посередине, большой взрыв — тряска
    let sx = 0;
    let sy = 0;
    for (const [x, y] of st.removed) {
      sx += x;
      sy += y;
      const id = this.disp[y][x];
      const t = id == null ? null : this.info.get(id);
      const cx = x * C + C / 2;
      const cy = y * C + C / 2;
      this.fx.burst(cx, cy, chip(t?.kind ?? 0), 6, 170, 4);
      if (t && t.special !== 'none') this.fx.ring(cx, cy, t.special === 'bomb' ? '#ff8040' : '#fff4b0', t.special === 'bomb' ? 90 : 60);
      if (id == null) continue;
      const p = this.pos.get(id);
      if (p) this.fading.set(id, { ...p });
      this.pos.delete(id);
      this.disp[y][x] = null;
    }
    for (const m of st.made)
      if (m.id != null) {
        this.disp[m.y][m.x] = m.id;
        this.pos.set(m.id, { x: m.x, y: m.y, a: 1 });
        this.target.set(m.id, { x: m.x, y: m.y });
      }
    if (st.removed.length) {
      const k = st.removed.length;
      this.fx.text((sx / k) * C + C / 2, (sy / k) * C + C / 2, `+${st.points}`, '#fff6c0', 26 + Math.min(12, k));
      if (chain > 1) this.fx.text((sx / k) * C + C / 2, (sy / k) * C + C / 2 - 34, `Каскад ×${chain}`, '#ffd040', 30);
      if (k >= 6) this.fx.shake(Math.min(10, k / 2));
      Sound.capture();
      Sound.beep(900 + Math.min(6, chain) * 220, 0.05, 0.08);
    }
    await sleep(170);
    this.fading.clear();
    // падение
    for (const f of st.falls) {
      if (f.from >= 0 && this.disp[f.from]?.[f.x] === f.id) this.disp[f.from][f.x] = null;
      this.disp[f.to][f.x] = f.id;
      if (!this.pos.has(f.id)) this.pos.set(f.id, { x: f.x, y: f.from, a: 1 });
      this.target.set(f.id, { x: f.x, y: f.to });
    }
    this.hud();
    await sleep(st.falls.length ? 230 : 60);
  }

  private async finish() {
    const b = this.board!;
    await sleep(300);
    const pr = loadProgress();
    if (b.won) {
      Sound.win();
      const prev = pr.best[b.spec.n];
      if (!prev || b.score > prev.score) pr.best[b.spec.n] = { score: b.score, stars: Math.max(prev?.stars ?? 0, b.stars()) };
      pr.open = Math.max(pr.open, Math.min(100, b.spec.n + 1));
      store.set(KEY, pr);
      // в рекорды — сумма лучших очков всех уровней
      this.opts.onScore(Object.values(pr.best).reduce((a, x) => a + x.score, 0));
    }
    const box = h(`<div class="tr-end"><h2>${b.won ? 'Клад найден!' : 'Ходы кончились'}</h2>
      <p>${b.won ? `Очки: <b>${b.score}</b> · ${'★'.repeat(b.stars())}${'☆'.repeat(3 - b.stars())}` : esc(b.spec.goal === 'dirt' ? `Осталось земли: ${b.dirtLeft}` : `Не хватило ${b.spec.target - b.score} очков`)}</p>
      <div>${b.won && b.spec.n < 100 ? '<button class="btn primary" data-e="next">Дальше</button>' : ''}<button class="btn" data-e="again">Ещё раз</button><button class="btn" data-e="map">Уровни</button></div></div>`);
    this.el.querySelector('.tr-play')?.appendChild(box);
    (box.querySelector('[data-e=again]') as HTMLButtonElement).onclick = () => this.start(b.spec.n);
    (box.querySelector('[data-e=map]') as HTMLButtonElement).onclick = () => this.showMap();
    const nx = box.querySelector('[data-e=next]') as HTMLButtonElement | null;
    if (nx) nx.onclick = () => this.start(b.spec.n + 1);
  }

  // ---------------------------------------------------------------- рисование

  private draw() {
    const b = this.board;
    if (!b) return;
    const g = this.g;
    g.save();
    const [ox, oy] = this.fx.offset();
    g.translate(ox, oy);
    // клетки: песок (шахматкой чуть темнее), земля — в ямке с тенью, камень — кирпич
    const pat = (im: HTMLImageElement | null, cur: CanvasPattern | null) => {
      if (cur || !im) return cur;
      const p = g.createPattern(im, 'repeat');
      p?.setTransform(new DOMMatrix().scale((C * 2) / im.naturalWidth));
      return p;
    };
    this.sandPat = pat(ART.get('sand'), this.sandPat);
    this.dirtPat = pat(ART.get('dirt'), this.dirtPat);
    g.fillStyle = this.sandPat ?? '#e4d09a';
    g.fillRect(-10, -10, N * C + 20, N * C + 20);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const c = b.cells[y][x];
        if ((x + y) % 2) {
          g.fillStyle = 'rgba(90,60,10,0.07)';
          g.fillRect(x * C, y * C, C, C);
        }
        if (c.dirt) {
          g.fillStyle = this.dirtPat ?? '#6a4420';
          g.fillRect(x * C + 1, y * C + 1, C - 2, C - 2);
          if (c.dirt > 1) {
            g.fillStyle = 'rgba(20,10,0,0.35)';
            g.fillRect(x * C + 1, y * C + 1, C - 2, C - 2);
          }
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.fillRect(x * C + 1, y * C + 1, C - 2, 4);
          g.fillRect(x * C + 1, y * C + 1, 3, C - 2);
        }
        if (c.stone) this.stone(x * C, y * C);
      }
    // фишки: плавно к цели
    for (const [id, t] of this.target) {
      const p = this.pos.get(id);
      if (!p) continue;
      p.x += (t.x - p.x) * 0.35;
      p.y += (t.y - p.y) * 0.35;
      if (Math.abs(t.x - p.x) < 0.01) p.x = t.x;
      if (Math.abs(t.y - p.y) < 0.01) p.y = t.y;
    }
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const id = this.disp[y][x];
        if (id == null) continue;
        const p = this.pos.get(id);
        const t = this.info.get(id);
        if (!p || !t) continue;
        // выбранная — покачивается и чуть больше, подсказка — подпрыгивает
        const selected = this.sel && this.sel[0] === x && this.sel[1] === y;
        const hinted = this.hintAt && ((this.hintAt[0] === x && this.hintAt[1] === y) || (this.hintAt[2] === x && this.hintAt[3] === y));
        const scale = selected ? 1.12 + Math.sin(this.t * 8) * 0.04 : 1;
        const lift = hinted ? -Math.abs(Math.sin(this.t * 6)) * 6 : 0;
        this.tile(t, p.x * C, p.y * C + lift, 1, scale);
      }
    for (const [id, p] of this.fading) {
      const t = this.info.get(id);
      if (t) this.tile(t, p.x * C, p.y * C, 0.5, 1.25);
    }
    if (this.sel) {
      g.strokeStyle = `rgba(255,255,255,${0.6 + Math.sin(this.t * 8) * 0.3})`;
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(this.sel[0] * C + 3, this.sel[1] * C + 3, C - 6, C - 6, 10);
      g.stroke();
    }
    this.fx.draw(g);
    g.restore();
  }

  private stone(x: number, y: number) {
    const g = this.g;
    const im = ART.get('stone');
    if (im) {
      g.drawImage(im, x + 2, y + 2, C - 4, C - 4);
      return;
    }
    const grad = g.createRadialGradient(x + C * 0.4, y + C * 0.35, 4, x + C / 2, y + C / 2, C * 0.5);
    grad.addColorStop(0, '#b8b8b8');
    grad.addColorStop(1, '#5a5a5a');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x + 10, y + 18);
    g.lineTo(x + 30, y + 6);
    g.lineTo(x + 54, y + 14);
    g.lineTo(x + 58, y + 44);
    g.lineTo(x + 36, y + 58);
    g.lineTo(x + 8, y + 48);
    g.closePath();
    g.fill();
  }

  private tile(t: Tile, x: number, y: number, alpha: number, scale = 1) {
    const g = this.g;
    const cx = x + C / 2;
    const cy = y + C / 2;
    if (t.special === 'brick') {
      drawBrick(g, x, y, C, t.t ?? 0, alpha, this.t);
      return;
    }
    const im = ART.get(t.special === 'nugget' ? 'nugget' : GEM[t.kind % GEM.length]);
    if (im) {
      g.save();
      g.globalAlpha = alpha;
      const s = C * 0.9 * scale;
      // спецфишка светится
      if (t.special !== 'none') {
        const glow = g.createRadialGradient(cx, cy, 4, cx, cy, C * 0.55);
        const k = 0.55 + Math.sin(this.t * 5 + t.id) * 0.2;
        glow.addColorStop(0, `rgba(255,240,170,${k})`);
        glow.addColorStop(1, 'rgba(255,240,170,0)');
        g.fillStyle = glow;
        g.fillRect(x - 6, y - 6, C + 12, C + 12);
      }
      g.shadowColor = 'rgba(60,30,0,0.45)';
      g.shadowOffsetY = 3;
      g.shadowBlur = 4;
      g.drawImage(im, cx - s / 2, cy - s / 2, s, s);
      g.shadowColor = 'transparent';
      // значок: лопата поперёк (строка) или вдоль (столбец), динамит — в углу
      const badge = t.special === 'row' || t.special === 'col' ? ART.get('shovel') : t.special === 'bomb' ? ART.get('dynamite') : null;
      if (badge) {
        g.translate(cx + C * 0.2, cy + C * 0.2);
        if (t.special === 'row') g.rotate(-Math.PI / 4);
        if (t.special === 'col') g.rotate(Math.PI / 4);
        g.drawImage(badge, -C * 0.28, -C * 0.28, C * 0.56, C * 0.56);
      }
      g.restore();
      return;
    }
    g.globalAlpha = alpha;
    const gem = (col: string, light: string, path: () => void) => {
      const gr = g.createLinearGradient(x, y, x + C, y + C);
      gr.addColorStop(0, light);
      gr.addColorStop(1, col);
      g.fillStyle = gr;
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1.5;
      g.beginPath();
      path();
      g.closePath();
      g.fill();
      g.stroke();
    };
    switch (t.kind) {
      case 0: // монета
        gem('#c89010', '#ffe680', () => g.arc(cx, cy, C * 0.34, 0, Math.PI * 2));
        g.fillStyle = '#a87808';
        g.font = `bold ${C * 0.36}px Georgia, serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('₽', cx, cy + 2);
        break;
      case 1: // рубин
        gem('#a01020', '#ff6a7a', () => {
          for (let i = 0; i < 6; i++) g.lineTo(cx + Math.cos((i * Math.PI) / 3) * C * 0.34, cy + Math.sin((i * Math.PI) / 3) * C * 0.34);
        });
        break;
      case 2: // изумруд
        gem('#107a3a', '#6ae09a', () => {
          const s = C * 0.3;
          g.moveTo(cx - s * 0.6, cy - s);
          g.lineTo(cx + s * 0.6, cy - s);
          g.lineTo(cx + s, cy - s * 0.6);
          g.lineTo(cx + s, cy + s * 0.6);
          g.lineTo(cx + s * 0.6, cy + s);
          g.lineTo(cx - s * 0.6, cy + s);
          g.lineTo(cx - s, cy + s * 0.6);
          g.lineTo(cx - s, cy - s * 0.6);
        });
        break;
      case 3: // сапфир
        gem('#1a3aa8', '#7aa0ff', () => {
          g.moveTo(cx, cy - C * 0.36);
          g.lineTo(cx + C * 0.3, cy);
          g.lineTo(cx, cy + C * 0.36);
          g.lineTo(cx - C * 0.3, cy);
        });
        break;
      case 4: // аметист
        gem('#6a1aa0', '#d08aff', () => {
          g.moveTo(cx, cy - C * 0.34);
          g.lineTo(cx + C * 0.34, cy + C * 0.26);
          g.lineTo(cx - C * 0.34, cy + C * 0.26);
        });
        break;
      case 5: // жемчуг
        {
          const gr = g.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, C * 0.3);
          gr.addColorStop(0, '#ffffff');
          gr.addColorStop(1, '#c8c0d8');
          g.fillStyle = gr;
          g.beginPath();
          g.arc(cx, cy, C * 0.28, 0, Math.PI * 2);
          g.fill();
        }
        break;
      default: // перстень
        g.strokeStyle = '#d8a020';
        g.lineWidth = C * 0.09;
        g.beginPath();
        g.arc(cx, cy + 4, C * 0.22, 0, Math.PI * 2);
        g.stroke();
        gem('#1a6ab8', '#9ad8ff', () => g.arc(cx, cy - C * 0.2, C * 0.12, 0, Math.PI * 2));
    }
    // блик
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.ellipse(cx - C * 0.1, cy - C * 0.14, C * 0.09, C * 0.05, -0.6, 0, Math.PI * 2);
    g.fill();
    this.special(t.special, cx, cy);
    g.globalAlpha = 1;
  }

  private special(sp: Special, cx: number, cy: number) {
    if (sp === 'none') return;
    const g = this.g;
    g.save();
    if (sp === 'row' || sp === 'col') {
      // лопата поперёк
      g.translate(cx, cy);
      if (sp === 'col') g.rotate(Math.PI / 2);
      g.strokeStyle = '#fff';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-C * 0.4, 0);
      g.lineTo(C * 0.4, 0);
      g.stroke();
      g.fillStyle = '#fff';
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * C * 0.45, 0);
        g.lineTo(s * C * 0.32, -7);
        g.lineTo(s * C * 0.32, 7);
        g.fill();
      }
    } else if (sp === 'bomb') {
      g.fillStyle = '#c8241c';
      g.fillRect(cx - 7, cy - C * 0.3, 14, C * 0.6);
      g.strokeStyle = '#ffd24a';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx, cy - C * 0.3);
      g.quadraticCurveTo(cx + 10, cy - C * 0.42, cx + 4, cy - C * 0.46);
      g.stroke();
    } else if (sp === 'nugget') {
      const gr = g.createRadialGradient(cx, cy, 2, cx, cy, C * 0.42);
      gr.addColorStop(0, 'rgba(255,240,150,0.95)');
      gr.addColorStop(1, 'rgba(255,200,40,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, cy, C * 0.45, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f0c020';
      g.beginPath();
      g.moveTo(cx - 12, cy + 8);
      g.lineTo(cx - 6, cy - 10);
      g.lineTo(cx + 10, cy - 8);
      g.lineTo(cx + 13, cy + 6);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  /** Сетевая игра: выбыл или партия кончилась — ходить нельзя. */
  frozen = false;

  destroy() {
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }
}

/** Кирпич: кладка с раствором, на нём — сколько своих ходов до камня (последний ход — красным, дрожит). */
export function drawBrick(g: CanvasRenderingContext2D, x: number, y: number, C: number, t: number, alpha = 1, time = 0) {
  g.save();
  g.globalAlpha = alpha;
  const j = t <= 1 ? Math.sin(time * 30) * 1.2 : 0;
  g.translate(j, 0);
  const pad = C * 0.06;
  const w = C - pad * 2;
  g.fillStyle = '#d8cfc0';
  g.beginPath();
  g.roundRect(x + pad, y + pad, w, w, C * 0.08);
  g.fill();
  const bh = w / 3;
  for (let r = 0; r < 3; r++) {
    const off = r % 2 ? 0 : w / 4;
    for (let k = -1; k < 2; k++) {
      const bx = x + pad + off + (k * w) / 2;
      const x0 = Math.max(x + pad + 1, bx + 1);
      const x1 = Math.min(x + C - pad - 1, bx + w / 2 - 1);
      if (x1 <= x0) continue;
      g.fillStyle = (r + k) % 2 ? '#b0452a' : '#a03a22';
      g.fillRect(x0, y + pad + r * bh + 1, x1 - x0, bh - 2);
    }
  }
  g.fillStyle = 'rgba(0,0,0,.5)';
  g.beginPath();
  g.arc(x + C / 2, y + C / 2, C * 0.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = t <= 1 ? '#ff6a50' : '#fff6c0';
  g.font = `900 ${Math.round(C * 0.32)}px 'PT Sans', Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(t), x + C / 2, y + C / 2 + 1);
  g.restore();
}

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'treasures',
  title: 'Клад',
  about: 'Три в ряд на сто уровней: собирайте сокровища рядами, откапывайте клад из-под земли, разбивайте камни.',
  controls: `<p>Нажмите фишку, потом соседнюю — поменяются местами (или проведите пальцем). Ряд из трёх и больше исчезает.</p>
    <p>Четыре в ряд — <b>лопата</b> (чистит строку или столбец), пять — <b>самородок</b> (поменяйте с любой — исчезнут все такие), уголок — <b>динамит</b> (3×3, разбивает камни).</p>
    <p>Каждый третий уровень — «откопать клад»: расчистить всю землю. В рекорды идёт сумма лучших очков по уровням.</p>`,
  modes: [{ id: 'levels', label: 'Сто уровней' }],
  net: { label: 'Дуэль и битва', hint: 'по сети или с ботами: кирпичи сопернику, до десяти игроков', load: () => import('./net').then((m) => m.default) },
  mount(root, opts) {
    return new Game(root, opts);
  },
};

export default mod;
