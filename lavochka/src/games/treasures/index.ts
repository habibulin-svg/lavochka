/* «Клад» — экран: карта ста уровней (звёзды, открытые и закрытые) и поле 8×8 — песок, земля, камни, сокровища
 * (монета, рубин, изумруд, сапфир, аметист, жемчуг, перстень), спецфишки (лопата, динамит, самородок).
 * Ход — нажать фишку и соседнюю (или провести пальцем). Анимация: обмен, исчезновение, падение. Прогресс — на этом устройстве. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
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

type Pos = { x: number; y: number; a: number };

class Game {
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

  constructor(
    root: HTMLElement,
    private opts: ArcadeOpts
  ) {
    this.el = h('<div class="tr-dev"></div>');
    root.appendChild(this.el);
    this.showMap();
  }

  // ---------------------------------------------------------------- карта уровней

  private showMap() {
    cancelAnimationFrame(this.raf);
    this.board = null;
    const pr = loadProgress();
    let s = '<div class="tr-map"><div class="tr-map-t">Сто кладов — выберите уровень</div><div class="tr-grid">';
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
    const b = new Board(levelSpec(n));
    this.board = b;
    this.el.innerHTML = `<div class="tr-play">
      <div class="tr-hud"></div>
      <canvas width="${N * C * 2}" height="${N * C * 2}"></canvas>
      <div class="tr-btns"><button class="btn" data-b="map">← Уровни</button><button class="btn" data-b="hint">Подсказка</button><button class="btn" data-b="again">Заново</button></div>
    </div>`;
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    this.g.setTransform(2, 0, 0, 2, 0, 0);
    (this.el.querySelector('[data-b=map]') as HTMLButtonElement).onclick = () => this.showMap();
    (this.el.querySelector('[data-b=again]') as HTMLButtonElement).onclick = () => this.start(n);
    (this.el.querySelector('[data-b=hint]') as HTMLButtonElement).onclick = () => {
      this.hintAt = this.board?.hint() ?? null;
      setTimeout(() => (this.hintAt = null), 1500);
    };
    this.cv.addEventListener('pointerdown', (e) => this.pointer(e, 'down'));
    this.cv.addEventListener('pointermove', (e) => this.pointer(e, 'move'));
    this.cv.addEventListener('pointerup', () => (this.down = null));
    this.sync(true);
    this.hud();
    const loop = () => {
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
    if (!b) return;
    const goal = b.spec.goal === 'dirt' ? `откопать клад: осталось земли <b>${b.dirtLeft}</b>` : `цель: <b>${b.spec.target}</b> очков`;
    (this.el.querySelector('.tr-hud') as HTMLElement).innerHTML = `<span>Уровень <b>${b.spec.n}</b></span><span>ходов <b>${b.moves}</b></span><span>очки <b>${b.score}</b></span><span>${goal}</span><span class="tr-stars">${'★'.repeat(b.stars())}${'☆'.repeat(3 - b.stars())}</span>`;
  }

  private cellAt(e: PointerEvent) {
    const r = this.cv.getBoundingClientRect();
    return { cx: Math.floor(((e.clientX - r.left) / r.width) * N), cy: Math.floor(((e.clientY - r.top) / r.height) * N), x: e.clientX, y: e.clientY };
  }

  private pointer(e: PointerEvent, kind: 'down' | 'move') {
    if (this.busy || !this.board) return;
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
    for (const st of steps) await this.playStep(st);
    this.sync(false);
    this.hud();
    this.busy = false;
    if (b.won || b.lost) await this.finish();
  }

  private async playStep(st: Step) {
    for (const t of st.added) this.info.set(t.id, t);
    // исчезновение
    for (const [x, y] of st.removed) {
      const id = this.disp[y][x];
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
    if (st.removed.length) Sound.capture();
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
    // клетки
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const c = b.cells[y][x];
        g.fillStyle = (x + y) % 2 ? '#e8d4a0' : '#e0cb94';
        g.fillRect(x * C, y * C, C, C);
        if (c.dirt) {
          g.fillStyle = c.dirt > 1 ? '#5a3a1a' : '#8a5a2a';
          g.fillRect(x * C + 2, y * C + 2, C - 4, C - 4);
          g.fillStyle = 'rgba(0,0,0,0.15)';
          for (let i = 0; i < 6; i++) g.fillRect(x * C + ((i * 23) % (C - 8)) + 4, y * C + ((i * 37) % (C - 8)) + 4, 3, 3);
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
        if (p && t) this.tile(t, p.x * C, p.y * C, 1);
      }
    for (const [id, p] of this.fading) {
      const t = this.info.get(id);
      if (t) this.tile(t, p.x * C, p.y * C, 0.4);
    }
    // выбор и подсказка
    const ring = (x: number, y: number, col: string) => {
      g.strokeStyle = col;
      g.lineWidth = 3;
      g.strokeRect(x * C + 3, y * C + 3, C - 6, C - 6);
    };
    if (this.sel) ring(this.sel[0], this.sel[1], '#fff');
    if (this.hintAt) {
      ring(this.hintAt[0], this.hintAt[1], '#ffd24a');
      ring(this.hintAt[2], this.hintAt[3], '#ffd24a');
    }
  }

  private stone(x: number, y: number) {
    const g = this.g;
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

  private tile(t: Tile, x: number, y: number, alpha: number) {
    const g = this.g;
    const cx = x + C / 2;
    const cy = y + C / 2;
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

  destroy() {
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }
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
  mount(root, opts) {
    return new Game(root, opts);
  },
};

export default mod;
