/* ГОПС — экран: двор сверху (асфальт, гаражи, ящики, люк), гопники в кепках, собаки и дворники, петарды с фитилём, огонь крестом.
 * Один: стрелки или WASD, петарда — пробел или Enter. Вдвоём: первый — WASD и пробел, второй — стрелки и Enter. На телефоне — крестовина и кнопка.
 * «Районы» — десять дворов подряд (все враги прогнаны — открыт люк), «Стенка на стенку» — до трёх побед против ботов. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import { DISTRICTS, FUSE, GH, Gops, GW, type Input, type Mover } from './logic';
import './gops.css';

const T = 48;
const CW = GW * T;
const CH = GH * T;
const CAPS = ['#d8241c', '#2050c8', '#2a9a3a', '#e8b020'];

type Mode = 'story1' | 'story2' | 'battle1' | 'battle2';

class Yard {
  private el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private game: Gops;
  private keys = new Set<string>();
  private pad = { dx: 0, dy: 0, bomb: false };
  private raf = 0;
  private last = 0;
  private pauseT = 0;
  private reported = false;
  private onKey = (e: KeyboardEvent) => this.key(e, true);
  private onKeyUp = (e: KeyboardEvent) => this.key(e, false);

  constructor(
    root: HTMLElement,
    private mode: Mode,
    private opts: ArcadeOpts
  ) {
    this.el = h(`<div class="gp-dev"><div class="gp-hud"></div><canvas width="${CW * 2}" height="${CH * 2}"></canvas>
      <div class="gp-touch"><div class="gp-pad"><button data-d="0,-1">▲</button><button data-d="-1,0">◀</button><button data-d="1,0">▶</button><button data-d="0,1">▼</button></div><button class="gp-bomb">💥</button></div></div>`);
    root.appendChild(this.el);
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    this.g.setTransform(2, 0, 0, 2, 0, 0);
    this.game = this.fresh();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-d]')) {
      const [dx, dy] = b.dataset.d!.split(',').map(Number);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        Sound.unlock();
        this.pad.dx = dx;
        this.pad.dy = dy;
      });
      const up = () => {
        this.pad.dx = 0;
        this.pad.dy = 0;
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
    }
    const bomb = this.el.querySelector('.gp-bomb') as HTMLButtonElement;
    bomb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      Sound.unlock();
      this.pad.bomb = true;
    });
    bomb.addEventListener('pointerup', () => (this.pad.bomb = false));
    this.cv.addEventListener('pointerdown', () => this.game.over && this.restart());
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private fresh(level = 1) {
    const two = this.mode.endsWith('2');
    return new Gops(this.mode.startsWith('story') ? 'story' : 'battle', two ? 2 : 1, 4, level, (Math.random() * 1e9) | 0);
  }

  private restart() {
    this.game = this.fresh(this.game.mode === 'story' && !this.game.won ? this.game.level : 1);
    this.reported = false;
  }

  private key(e: KeyboardEvent, down: boolean) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const known = ['w', 'a', 's', 'd', 'ц', 'ф', 'ы', 'в', ' ', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!known.includes(k) || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.preventDefault();
    Sound.unlock();
    if (down && this.game.over && (k === ' ' || k === 'Enter')) return this.restart();
    if (down) this.keys.add(k);
    else this.keys.delete(k);
  }

  private inputs(): Input[] {
    const k = this.keys;
    const two = this.mode.endsWith('2');
    const has = (...xs: string[]) => xs.some((x) => k.has(x));
    const wasd = { dx: (has('d', 'в') ? 1 : 0) - (has('a', 'ф') ? 1 : 0), dy: (has('s', 'ы') ? 1 : 0) - (has('w', 'ц') ? 1 : 0) };
    const arrows = { dx: (has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0), dy: (has('ArrowDown') ? 1 : 0) - (has('ArrowUp') ? 1 : 0) };
    if (!two) {
      const dx = wasd.dx || arrows.dx || this.pad.dx;
      const dy = wasd.dy || arrows.dy || this.pad.dy;
      return [{ dx, dy, bomb: has(' ', 'Enter') || this.pad.bomb }];
    }
    return [
      { dx: wasd.dx || this.pad.dx, dy: wasd.dy || this.pad.dy, bomb: has(' ') || this.pad.bomb },
      { dx: arrows.dx, dy: arrows.dy, bomb: has('Enter') },
    ];
  }

  private frame(t: number) {
    const dt = Math.min(50, t - this.last);
    this.last = t;
    const g = this.game;
    if (g.roundWinner != null && !g.over) {
      this.pauseT += dt;
      if (this.pauseT > 1800) {
        this.pauseT = 0;
        g.nextRound();
      }
    } else g.update(dt, this.inputs());
    for (const s of g.sounds) {
      if (s === 'boom') Sound.beep(120, 0.18, 0.18);
      else if (s === 'place') Sound.beep(600, 0.03, 0.08);
      else if (s === 'bonus') Sound.beep(2200, 0.06, 0.08);
      else if (s === 'die') Sound.nomove();
      else if (s === 'exit') Sound.beep(1500, 0.15, 0.08);
      else if (s === 'win') Sound.win();
    }
    g.sounds.length = 0;
    if (g.over && !this.reported) {
      this.reported = true;
      if (g.mode === 'story') this.opts.onScore(g.score);
      else if (g.won) this.opts.onScore(1000 + Math.max(0, 600 - Math.round(g.time)));
    }
    this.draw();
    this.hud();
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
  }

  private hud() {
    const g = this.game;
    const el = this.el.querySelector('.gp-hud') as HTMLElement;
    if (g.mode === 'story') el.innerHTML = `<span>Район <b>${g.level}</b>: ${DISTRICTS[g.level - 1]}</span><span>очки <b>${g.score}</b></span><span>${g.exitOpen ? '<b>люк открыт!</b>' : `врагов: <b>${g.enemies.filter((e) => e.alive).length}</b>`}</span>`;
    else el.innerHTML = g.players.map((p, i) => `<span style="color:${CAPS[i]}">${p.human != null ? `игрок ${p.human + 1}` : 'бот'}: <b>${p.wins}</b></span>`).join('');
  }

  private mv(m: Mover): [number, number] {
    const k = m.t;
    return [(m.x + (m.fx - m.x) * k) * T, (m.y + (m.fy - m.y) * k) * T];
  }

  private draw() {
    const c = this.g;
    const g = this.game;
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        const px = x * T;
        const py = y * T;
        const cell = g.grid[y][x];
        c.fillStyle = (x + y) % 2 ? '#5a5a5e' : '#626266';
        c.fillRect(px, py, T, T);
        const b = g.bonus[y][x];
        if (cell === 'floor' && b) this.bonus(b, px, py, g.exitOpen);
        if (cell === 'wall') this.garage(px, py, x === 0 || y === 0 || x === GW - 1 || y === GH - 1);
        if (cell === 'crate') this.crate(px, py);
      }
    // петарды
    for (const b of g.bombs) {
      const px = b.x * T + T / 2;
      const py = b.y * T + T / 2;
      const pulse = 1 + 0.08 * Math.sin((FUSE - b.t) * 14);
      c.save();
      c.translate(px, py);
      c.scale(pulse, pulse);
      c.fillStyle = '#c8241c';
      c.fillRect(-7, -14, 14, 26);
      c.fillStyle = '#f0e0b0';
      c.fillRect(-7, -4, 14, 5);
      c.strokeStyle = '#333';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, -14);
      c.quadraticCurveTo(6, -20, 4, -24);
      c.stroke();
      c.fillStyle = Math.floor(b.t * 10) % 2 ? '#ffd24a' : '#ff7a1a';
      c.beginPath();
      c.arc(4, -24, 3.5, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    // огонь
    for (const f of g.flames) {
      const gr = c.createRadialGradient(f.x * T + T / 2, f.y * T + T / 2, 2, f.x * T + T / 2, f.y * T + T / 2, T * 0.7);
      gr.addColorStop(0, `rgba(255,250,200,${f.t * 2})`);
      gr.addColorStop(0.5, `rgba(255,150,30,${f.t * 1.6})`);
      gr.addColorStop(1, 'rgba(200,40,10,0)');
      c.fillStyle = gr;
      c.fillRect(f.x * T - 6, f.y * T - 6, T + 12, T + 12);
    }
    // враги
    for (const e of g.enemies) {
      if (!e.alive) continue;
      const [x, y] = this.mv(e);
      if (e.kind === 'dog') {
        c.fillStyle = '#8a5a2a';
        c.beginPath();
        c.ellipse(x + T / 2, y + T / 2 + 4, 16, 10, 0, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.arc(x + T / 2 + 14 * Math.sign(e.dir[0] || 1), y + T / 2 - 2, 8, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#111';
        c.beginPath();
        c.arc(x + T / 2 + 18 * Math.sign(e.dir[0] || 1), y + T / 2 - 4, 2, 0, Math.PI * 2);
        c.fill();
      } else {
        c.fillStyle = '#f07a1a';
        c.beginPath();
        c.arc(x + T / 2, y + T / 2 + 4, 14, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#f0c8a0';
        c.beginPath();
        c.arc(x + T / 2, y + T / 2 - 8, 8, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#8a6a3a';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(x + T / 2 + 12, y + T / 2 - 14);
        c.lineTo(x + T / 2 + 18, y + T / 2 + 18);
        c.stroke();
      }
    }
    // гопники в кепках
    g.players.forEach((p, i) => {
      if (!p.alive) return;
      const [x, y] = this.mv(p);
      const cx = x + T / 2;
      const cy = y + T / 2;
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.beginPath();
      c.ellipse(cx + 2, cy + 14, 14, 6, 0, 0, Math.PI * 2);
      c.fill();
      // спортивка
      c.fillStyle = '#1a1a2a';
      c.beginPath();
      c.ellipse(cx, cy + 6, 14, 12, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#f4f4f4';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cx - 10, cy + 2);
      c.lineTo(cx - 10, cy + 14);
      c.moveTo(cx + 10, cy + 2);
      c.lineTo(cx + 10, cy + 14);
      c.stroke();
      // голова и кепка
      c.fillStyle = '#f0c8a0';
      c.beginPath();
      c.arc(cx, cy - 6, 10, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = CAPS[i];
      c.beginPath();
      c.arc(cx, cy - 9, 10, Math.PI, 0);
      c.fill();
      c.fillRect(cx - 2, cy - 11, 16, 4);
    });
    // надписи
    c.textAlign = 'center';
    if (g.roundWinner != null && !g.over) this.banner(g.roundWinner >= 0 ? `Раунд — ${g.players[g.roundWinner].human != null ? `игрок ${g.players[g.roundWinner].human! + 1}` : 'бот'}` : 'Ничья', 'следующий раунд…');
    else if (g.over) {
      const t = g.mode === 'story' ? (g.won ? 'Все десять районов наши!' : `Свалили в районе «${DISTRICTS[g.level - 1]}»`) : g.won ? 'Победа!' : 'Проиграли';
      this.banner(t, `очки ${g.score} · пробел или нажатие — ещё раз`);
    }
    c.textAlign = 'start';
  }

  private garage(px: number, py: number, fence: boolean) {
    const c = this.g;
    if (fence) {
      c.fillStyle = '#4a6a3a';
      c.fillRect(px, py, T, T);
      c.fillStyle = '#3a5a2a';
      for (let i = 0; i < 4; i++) c.fillRect(px + i * 12 + 2, py + 2, 8, T - 4);
      return;
    }
    const gr = c.createLinearGradient(px, py, px, py + T);
    gr.addColorStop(0, '#7a8a9a');
    gr.addColorStop(1, '#4a5a6a');
    c.fillStyle = gr;
    c.fillRect(px + 2, py + 2, T - 4, T - 4);
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      c.beginPath();
      c.moveTo(px + 4, py + 4 + i * 7);
      c.lineTo(px + T - 4, py + 4 + i * 7);
      c.stroke();
    }
  }

  private crate(px: number, py: number) {
    const c = this.g;
    c.fillStyle = '#b07a3a';
    c.fillRect(px + 4, py + 4, T - 8, T - 8);
    c.strokeStyle = '#6a4418';
    c.lineWidth = 3;
    c.strokeRect(px + 5, py + 5, T - 10, T - 10);
    c.beginPath();
    c.moveTo(px + 6, py + 6);
    c.lineTo(px + T - 6, py + T - 6);
    c.moveTo(px + T - 6, py + 6);
    c.lineTo(px + 6, py + T - 6);
    c.stroke();
  }

  private bonus(b: string, px: number, py: number, exitOpen: boolean) {
    const c = this.g;
    const cx = px + T / 2;
    const cy = py + T / 2;
    if (b === 'exit') {
      c.fillStyle = exitOpen ? '#1a1a1a' : '#3a3a3e';
      c.beginPath();
      c.arc(cx, cy, 17, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = exitOpen ? '#ffd24a' : '#777';
      c.lineWidth = 3;
      c.stroke();
      return;
    }
    c.fillStyle = 'rgba(255,240,180,0.25)';
    c.beginPath();
    c.arc(cx, cy, 18, 0, Math.PI * 2);
    c.fill();
    c.font = '24px serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(b === 'bomb' ? '🧨' : b === 'fire' ? '🔥' : '👟', cx, cy + 1);
    c.textAlign = 'start';
    c.textBaseline = 'alphabetic';
  }

  private banner(title: string, sub: string) {
    const c = this.g;
    c.fillStyle = 'rgba(10,10,20,0.78)';
    c.beginPath();
    c.roundRect(CW / 2 - 230, CH / 2 - 48, 460, 96, 16);
    c.fill();
    c.fillStyle = '#ffe9a0';
    c.font = 'bold 30px "PT Serif", Georgia, serif';
    c.fillText(title, CW / 2, CH / 2 + 2);
    c.fillStyle = '#e8eef8';
    c.font = '15px "PT Sans", Arial, sans-serif';
    c.fillText(sub, CW / 2, CH / 2 + 30);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.el.remove();
  }
}

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'gops',
  title: 'ГОПС',
  about: 'Гопники в кепках против дворовых собак и дворников: петарды рвут ящики и всё, что рядом. Десять районов или «стенка на стенку».',
  controls: `<p>Один: стрелки или <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>, петарда — <kbd>Пробел</kbd> или <kbd>Enter</kbd>.</p>
    <p>Вдвоём: первый — <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> и <kbd>Пробел</kbd>, второй — стрелки и <kbd>Enter</kbd>.</p>
    <p>Под ящиками — 🧨 ещё петарда, 🔥 дальше взрыв, 👟 кеды (быстрее) и люк: прогнали всех — люк открыт, ныряйте в следующий район.</p>`,
  modes: [
    { id: 'story1', label: 'Районы', hint: 'Десять районов, один игрок' },
    { id: 'story2', label: 'Районы вдвоём', hint: 'Десять районов вдвоём' },
    { id: 'battle1', label: 'Стенка на стенку', hint: 'Вы против трёх ботов, до трёх побед' },
    { id: 'battle2', label: 'Стенка вдвоём', hint: 'Двое людей и два бота' },
  ],
  mount(root, opts) {
    const m = (['story1', 'story2', 'battle1', 'battle2'] as const).includes(opts.mode as Mode) ? (opts.mode as Mode) : 'story1';
    return new Yard(root, m, opts);
  },
};

export default mod;
