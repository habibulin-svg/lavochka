/* Brick Game 2026 по сети — экран стола. Своё поле играется здесь же без задержек (тот же движок, что в одиночной игре);
 * установки фигур уходят в комнату, она повторяет их у себя. Если поля разошлись (мусор пришёл не в тот момент) — берём поле комнаты.
 * Вокруг — мини-поля соперников (до 15): нажатие — бить его; летящие атаки рисуются светящимися дугами. */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { Controls, Music, MUSIC, PAD_HTML, sfx } from './index';
import { accentOf, drawBackdrop, drawBoard, drawMini, drawPreview, frost, glowText, labelText } from './render';
import { H, HIDDEN, stepTet, type Place, type Tet, W } from './tetris';
import { cloneTet, gridString, type BrEvent, type BrIn, type BrView } from './versus';
import { SEATS } from './def';
import './brick2026.css';

const LW = 960;
const LH = 620;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  seat: number;
}

interface Shot {
  from: number;
  to: number;
  t: number;
  n: number;
}

export function createView(): GameView<BrView, BrEvent> {
  let ctx: ViewCtx;
  let root: HTMLElement;
  let cv: HTMLCanvasElement;
  let g: CanvasRenderingContext2D;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let time = 0;
  let view: BrView | null = null;
  let viewAt = 0;
  let local: Tet | null = null;
  let list: Place[] = [];
  let pick = -1;
  let ctl: Controls;
  const music = new Music();
  let rects: Rect[] = [];
  let shots: Shot[] = [];
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let flash = '';
  let flashT = 0;
  let lastSent = '';
  let lastSentAt = 0;

  const me = () => ctx.mySeats[0] ?? -1;
  const myBoard = () => view?.boards.find((b) => b.seat === me());
  const roomNow = () => (view ? view.t + (performance.now() - viewAt) / 1000 : 0);

  function sync(v: BrView) {
    const b = v.boards.find((x) => x.seat === me());
    if (!b?.full) return;
    const room = b.full;
    if (!local || (local.over && !b.out)) {
      local = cloneTet(room);
      list = [];
      return;
    }
    local.level = v.level;
    // комната не приняла нашу установку (её нет в отправленных) — берём её поле целиком
    if (room.seq < local.seq && !list.some((p) => p[0] === room.seq)) {
      local = cloneTet(room);
      list = [];
      return;
    }
    // комната дошла до той же фигуры — сверяем поле, мусор берём у неё
    if (local.cur && room.seq === local.seq) {
      local.garbage = room.garbage.map((x) => ({ ...x }));
      if (gridString(local) !== gridString(room) || local.grid.slice(0, HIDDEN * W).join() !== room.grid.slice(0, HIDDEN * W).join()) {
        local.grid = room.grid.slice();
        local.score = room.score;
        local.lines = room.lines;
      }
    }
  }

  function send() {
    if (!ctx.input || me() < 0 || !view || view.over) return;
    const inp: BrIn = { pl: list.slice(-6), target: pick };
    const json = JSON.stringify(inp);
    const now = performance.now();
    if (json === lastSent && now - lastSentAt < 400) return;
    lastSent = json;
    lastSentAt = now;
    ctx.input(me(), inp);
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    time += dt;
    const b = myBoard();
    if (local && view && !view.over && b && !b.out && !ctx.demo) {
      acc += dt;
      let n = 0;
      while (acc >= 1 / 60 && n < 6) {
        acc -= 1 / 60;
        n++;
        local.level = view.level;
        const ev = stepTet(local, ctl.read(), roomNow());
        for (const e of ev) {
          sfx(e);
          if (e.k === 'lock') {
            list = [...list.slice(-7), e.place];
            send();
          }
          if (e.k === 'clear' && e.n === 4) say('ЧЕТЫРЕ!');
        }
      }
      if (n >= 6) acc = 0;
    }
    render(dt);
  }

  function say(s: string) {
    flash = s;
    flashT = 1.2;
  }

  function render(dt: number) {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(60, Math.round(r.width * dpr));
    const hh = Math.max(60, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== hh) {
      cv.width = w;
      cv.height = hh;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const v = view;
    drawBackdrop(g, w, hh, time, v?.level ?? 0);
    if (!v) return;
    // на телефоне снизу экранные кнопки — раскладка над ними
    const padEl = cv.parentElement?.querySelector('.bg-pad') as HTMLElement | null;
    const lh = padEl && padEl.offsetParent ? Math.max(60, hh - 80 * dpr) : hh;
    scale = Math.min(w / LW, lh / LH);
    ox = (w - LW * scale) / 2;
    oy = (lh - LH * scale) / 2;
    g.setTransform(scale, 0, 0, scale, ox, oy);
    rects = [];
    const mine = myBoard();
    const others = v.boards.filter((b) => b.seat !== me());
    const watching = !mine;
    // своё поле по центру
    const c = 24;
    const bx = (LW - W * c) / 2;
    const by = 60;
    const t = local ?? (mine?.full as Tet | undefined) ?? (watching && v.boards[0]?.full ? (v.boards[0].full as Tet) : null);
    if (t) {
      drawBoard(g, t, bx, by, c, { ghost: true, incoming: mine?.inc ?? 0, dead: !!mine?.out, clearRows: t.clearRows, clearK: t.clearRows.length ? 1 - t.clearT / 18 : 0 });
      box(bx + W * c + 14, by - 6, 72, 76, t.level);
      drawPreview(g, t.next, bx + W * c + 50, by + 40, 18, t.level);
      labelText(g, 'СЛЕД.', bx + W * c + 50, by + 8, 10, '#eef3ff');
    }
    if (mine) {
      box(bx - 88, by - 6, 76, 96, v.level);
      glowText(g, `KO ${mine.ko}`, bx - 50, by + 20, 16, '#ffd23a', 'center');
      glowText(g, `★${mine.badges}`, bx - 50, by + 46, 16, '#ff8a3a', 'center');
      glowText(g, `${mine.lines} р.`, bx - 50, by + 72, 14, '#3affd8', 'center');
      rects.push({ x: bx, y: by, w: W * c, h: (H - HIDDEN) * c, seat: mine.seat });
    }
    glowText(g, `ОСТАЛОСЬ ${v.left}  ·  УРОВЕНЬ ${v.level}`, LW / 2, 28, 16, '#ffffff', 'center');
    // соперники: дуэль — крупно справа, битва — мини-поля слева и справа
    if (v.mode === 'duel' && others.length === 1) {
      const o = others[0];
      const mc = 14;
      const x = bx + W * c + 110;
      const y = by + 40;
      drawMini(g, o.g, x, y, mc, v.level, o.out);
      frame2(x, y, W * mc, (H - HIDDEN) * mc, o.seat === mine?.target, o.out);
      label(o.seat, x + (W * mc) / 2, y - 12, o);
      rects.push({ x, y, w: W * mc, h: (H - HIDDEN) * mc, seat: o.seat });
    } else {
      const mc = 5.5;
      const mw = W * mc;
      const mh = (H - HIDDEN) * mc;
      const slots: [number, number][] = [];
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) slots.push([20 + col * 95, 80 + row * 175]);
      for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) slots.push([LW - 220 + col * 105, 200 + row * 140]);
      others.slice(0, slots.length).forEach((o, i) => {
        const [x, y] = slots[i];
        drawMini(g, o.g, x, y, mc, v.level, o.out);
        frame2(x, y, mw, mh, o.seat === mine?.target, o.out);
        label(o.seat, x + mw / 2, y - 9, o);
        if (o.target === me() && !o.out) {
          g.fillStyle = '#ff3a3a';
          g.beginPath();
          g.arc(x + mw - 4, y + 4, 4, 0, Math.PI * 2);
          g.fill();
        }
        rects.push({ x, y, w: mw, h: mh, seat: o.seat });
      });
    }
    // летящие атаки
    shots = shots.filter((s) => (s.t += dt * 1.6) < 1);
    for (const s of shots) {
      const a = rects.find((q) => q.seat === s.from);
      const b = rects.find((q) => q.seat === s.to);
      if (!a || !b) continue;
      const x0 = a.x + a.w / 2;
      const y0 = a.y + a.h / 2;
      const x1 = b.x + b.w / 2;
      const y1 = b.y + b.h / 2;
      const k = s.t;
      const mx = (x0 + x1) / 2;
      const my = Math.min(y0, y1) - 120;
      const px = (1 - k) * (1 - k) * x0 + 2 * (1 - k) * k * mx + k * k * x1;
      const py = (1 - k) * (1 - k) * y0 + 2 * (1 - k) * k * my + k * k * y1;
      g.save();
      g.shadowColor = '#ff6a3a';
      g.shadowBlur = 16;
      g.fillStyle = '#ffd23a';
      g.beginPath();
      g.arc(px, py, 4 + s.n, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    if (flashT > 0) {
      flashT -= dt;
      g.globalAlpha = Math.min(1, flashT * 2);
      glowText(g, flash, LW / 2, by + 200, 30, '#ffffff', 'center');
      g.globalAlpha = 1;
    }
    if (mine?.out || v.over) {
      const won = v.winners.includes(me());
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(bx, by + 180, W * c, 120);
      glowText(g, won ? 'ПОБЕДА!' : `${mine?.place ?? '—'}-Е МЕСТО`, LW / 2, by + 230, 30, won ? '#3aff8a' : '#ffd23a', 'center');
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Табличка на матовом стекле с ободком цвета уровня. */
  function box(x: number, y: number, w: number, hh: number, level: number) {
    frost(g, x, y, w, hh, 8, 'rgba(5,7,24,0.62)');
    g.strokeStyle = accentOf(level) + 'aa';
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(x, y, w, hh, 8);
    g.stroke();
  }

  function frame2(x: number, y: number, w: number, hh: number, target: boolean, out: boolean) {
    g.strokeStyle = out ? '#5a2a2a' : target ? '#ff3a3a' : '#3a5aaa';
    g.lineWidth = target ? 3 : 1.5;
    g.strokeRect(x - 1.5, y - 1.5, w + 3, hh + 3);
  }

  function label(seat: number, x: number, y: number, b: { badges: number; place: number; out: boolean }) {
    const name = (ctx.name(seat) || SEATS[seat]?.name || '').replace(/<[^>]+>/g, '');
    glowText(g, `${name.slice(0, 9)}${b.badges ? ' ★' + b.badges : ''}${b.out ? ' ' + b.place : ''}`, x, y, 10, b.out ? '#a07070' : '#c8d8ff', 'center');
  }

  function onClick(e: PointerEvent) {
    if (ctx.demo) return;
    Sound.unlock();
    music.play(true);
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const x = ((e.clientX - r.left) * dpr - ox) / scale;
    const y = ((e.clientY - r.top) * dpr - oy) / scale;
    const hit = rects.find((q) => q.seat !== me() && x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
    if (hit) {
      pick = pick === hit.seat ? -1 : hit.seat;
      send();
    }
  }

  function controls() {
    const box = ctx.controls;
    if (!box || ctx.demo) return;
    box.innerHTML = '';
    const row = h(`<div class="bg-row"><span>Музыка</span><div class="seg"></div></div>`);
    const s = row.querySelector('.seg') as HTMLElement;
    for (const m of MUSIC) {
      const b = h<HTMLButtonElement>(`<button data-v="${m.id}">${m.label}</button>`);
      b.onclick = () => {
        music.set(m.id);
        s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        b.blur();
      };
      if (music.choice() === m.id) b.classList.add('on');
      s.appendChild(b);
    }
    box.appendChild(row);
  }

  return {
    mount(el, c) {
      ctx = c;
      root = h(`<div class="bg-wrap bg-net"><canvas class="bg-cv"></canvas>${ctx.demo ? '' : PAD_HTML}</div>`);
      el.appendChild(root);
      cv = root.querySelector('canvas') as HTMLCanvasElement;
      g = cv.getContext('2d')!;
      ctl = new Controls(() => music.play(true));
      const pad = root.querySelector('.bg-pad') as HTMLElement | null;
      if (pad) ctl.pad(pad, () => music.play(true));
      cv.addEventListener('pointerdown', onClick);
      controls();
      raf = requestAnimationFrame(frame);
      const iv = setInterval(send, 200);
      (root as HTMLElement & { _iv?: number })._iv = iv as unknown as number;
    },
    setView(v) {
      view = v;
      viewAt = performance.now();
      sync(v);
    },
    async play(_ev, v) {
      this.setView(v);
    },
    realtime(v, events) {
      view = v;
      viewAt = performance.now();
      sync(v);
      for (const e of events) {
        if (e.k === 'attack') {
          shots.push({ from: e.from, to: e.to, t: 0, n: Math.min(6, e.n) });
          if (e.from === me() || e.to === me()) sfx({ k: 'attack' });
        }
        if (e.k === 'out' && e.by === me()) {
          sfx({ k: 'ko' });
          say('KO!');
        }
        if (e.k === 'out' && e.seat === me()) sfx({ k: 'over' });
        if (e.k === 'land' && e.seat === me()) sfx({ k: 'garbage', n: e.n });
        if (e.k === 'end') music.play(false);
      }
    },
    setTurn() {},
    status(v) {
      if (!v) return '';
      return v.over ? 'Битва окончена' : `Осталось ${v.left} · уровень ${v.level}`;
    },
    playerStats(v, seat) {
      const b = v?.boards.find((x) => x.seat === seat);
      return b ? `${b.out ? `${b.place}-е место · ` : ''}KO <b>${b.ko}</b> · рядов ${b.lines}` : '';
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearInterval((root as HTMLElement & { _iv?: number })._iv);
      ctl?.destroy();
      music.stop();
      root?.remove();
    },
  };
}
