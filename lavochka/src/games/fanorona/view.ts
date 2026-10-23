/* Фанорона — отрисовка. Мадагаскарская доска «по-родному»: резное дерево с прорезанными линиями и зубчатым орнаментом
 * по краю, фишки — светлые ракушки-каури и тёмные семена; или каменная плита с выбитыми линиями и лунками, фишки — галька.
 * Во время цепочки — пройденный путь пунктиром; когда надо выбрать подход или отход — обе линии подсвечены. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { captures, count, dirOf, geo, legal, WHITE, type Action, type Event, type State } from './engine';
import './fanorona.css';

const M = 0.8; // поле вокруг точек
const X = (s: State, p: number) => M + (p % geo(s.cfg.size).w);
const Y = (s: State, p: number) => M + Math.floor(p / geo(s.cfg.size).w);

function defs(): string {
  return `<defs>
    <linearGradient id="fn-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9a4e26"/><stop offset="0.5" stop-color="#7c3a18"/><stop offset="1" stop-color="#5e2a10"/></linearGradient>
    <linearGradient id="fn-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a3012"/><stop offset="1" stop-color="#3a1806"/></linearGradient>
    <linearGradient id="fn-stone" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a8a294"/><stop offset="0.5" stop-color="#8d887c"/><stop offset="1" stop-color="#6e6a60"/></linearGradient>
    <radialGradient id="fn-hole" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#2e2a24"/><stop offset="0.8" stop-color="#4a463e"/><stop offset="1" stop-color="#b8b2a4"/></radialGradient>
    <radialGradient id="fn-shell" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fffdf6"/><stop offset="0.55" stop-color="#ece0c4"/><stop offset="1" stop-color="#a8957a"/></radialGradient>
    <radialGradient id="fn-seed" cx="36%" cy="30%" r="75%"><stop offset="0" stop-color="#8a5a3e"/><stop offset="0.5" stop-color="#3e2216"/><stop offset="1" stop-color="#140a06"/></radialGradient>
    <radialGradient id="fn-peb-w" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#d8d4ca"/><stop offset="1" stop-color="#8e8a80"/></radialGradient>
    <radialGradient id="fn-peb-b" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#6a6e72"/><stop offset="0.55" stop-color="#2c2e32"/><stop offset="1" stop-color="#0c0d0e"/></radialGradient>
    <radialGradient id="fn-sh" cx="50%" cy="50%" r="50%"><stop offset="0.55" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <filter id="fn-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.35 5" numOctaves="2" seed="3" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.12  0 0 0 0 0.04  0 0 0 0 0  0 0 0 0.55 -0.12" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
    </filter>
    <filter id="fn-granite" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="2.2" numOctaves="3" seed="5" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.15  0 0 0 0 0.14  0 0 0 0 0.12  0 0 0 0.7 -0.2" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
    </filter>
  </defs>`;
}

/** Линии доски: все соединения точек. */
function lines(s: State): string {
  const g = geo(s.cfg.size);
  let d = '';
  for (let p = 0; p < g.n; p++)
    for (const dir of [0, 1, 2, 7]) {
      const q = g.nb[p][dir];
      if (q >= 0) d += `M${X(s, p)} ${Y(s, p)}L${X(s, q)} ${Y(s, q)}`;
    }
  return d;
}

/** Зубчатый резной орнамент по краю (треугольники). */
function zigzag(x0: number, y0: number, x1: number, y1: number, n: number, k: number, fill: string): string {
  let o = '';
  const dx = (x1 - x0) / n;
  const dy = (y1 - y0) / n;
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * k;
  const ny = (dx / len) * k;
  for (let i = 0; i < n; i++) {
    const ax = x0 + dx * i;
    const ay = y0 + dy * i;
    o += `<path d="M${ax} ${ay}L${ax + dx / 2 + nx} ${ay + dy / 2 + ny}L${ax + dx} ${ay + dy}Z" fill="${fill}"/>`;
  }
  return o;
}

function board(s: State): string {
  const g = geo(s.cfg.size);
  const W = g.w - 1 + 2 * M;
  const H = g.h - 1 + 2 * M;
  let o = defs();
  const L = lines(s);
  if (s.cfg.look === 'wood') {
    o += `<rect x="0" y="0" width="${W}" height="${H}" rx="0.18" fill="url(#fn-rim)"/>`;
    o += `<rect x="0.08" y="0.08" width="${W - 0.16}" height="${H - 0.16}" rx="0.14" fill="url(#fn-wood)" filter="url(#fn-grain)"/>`;
    // резной бордюр: две бороздки и зубцы между ними
    const b1 = 0.2;
    const b2 = 0.42;
    o += `<rect x="${b1}" y="${b1}" width="${W - 2 * b1}" height="${H - 2 * b1}" fill="none" stroke="#2a1004" stroke-width="0.03"/>`;
    o += `<rect x="${b2}" y="${b2}" width="${W - 2 * b2}" height="${H - 2 * b2}" fill="none" stroke="#2a1004" stroke-width="0.03"/>`;
    const nz = (len: number) => Math.max(4, Math.round(len / 0.3));
    const m = (b1 + b2) / 2;
    const k = (b2 - b1) / 2 - 0.02;
    o += zigzag(b1 + 0.02, m + k / 2, W - b1 - 0.02, m + k / 2, nz(W), -k, '#3a1806');
    o += zigzag(W - b1 - 0.02, H - m - k / 2, b1 + 0.02, H - m - k / 2, nz(W), -k, '#3a1806');
    o += zigzag(m + k / 2, H - b1 - 0.02, m + k / 2, b1 + 0.02, nz(H), -k, '#3a1806');
    o += zigzag(W - m - k / 2, b1 + 0.02, W - m - k / 2, H - b1 - 0.02, nz(H), -k, '#3a1806');
    // прорезанные линии: светлая кромка снизу, тёмный жёлоб
    o += `<path d="${L}" fill="none" stroke="#c98a5a" stroke-width="0.07" stroke-linecap="round" transform="translate(0.018 0.022)" opacity="0.55"/>`;
    o += `<path d="${L}" fill="none" stroke="#2a1004" stroke-width="0.06" stroke-linecap="round"/>`;
    for (let p = 0; p < g.n; p++) o += `<circle cx="${X(s, p)}" cy="${Y(s, p)}" r="0.11" fill="#2a1004" stroke="#c98a5a" stroke-opacity="0.5" stroke-width="0.02"/>`;
  } else {
    o += `<rect x="0" y="0" width="${W}" height="${H}" rx="0.3" fill="url(#fn-stone)" filter="url(#fn-granite)" stroke="#4e4a42" stroke-width="0.05"/>`;
    o += `<path d="${L}" fill="none" stroke="#e4ded0" stroke-width="0.06" stroke-linecap="round" transform="translate(0.015 0.02)" opacity="0.5"/>`;
    o += `<path d="${L}" fill="none" stroke="#3e3a34" stroke-width="0.055" stroke-linecap="round"/>`;
    for (let p = 0; p < g.n; p++) o += `<circle cx="${X(s, p)}" cy="${Y(s, p)}" r="0.2" fill="url(#fn-hole)"/>`;
  }
  return o;
}

/** Поворот фишки «как легла» — от номера точки. */
const tilt = (p: number) => ((p * 67) % 70) - 35;

/** Ракушка-каури: овал с зубчатой щелью. */
function shell(x: number, y: number, p: number, r = 0.33): string {
  let teeth = '';
  for (let i = -3; i <= 3; i++) teeth += `M${x + i * r * 0.17} ${y - r * 0.12}v${r * 0.24}`;
  return `<ellipse cx="${x + 0.04}" cy="${y + 0.06}" rx="${r * 1.05}" ry="${r * 0.85}" fill="url(#fn-sh)"/>
    <g transform="rotate(${tilt(p)} ${x} ${y})">
      <ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.78}" fill="url(#fn-shell)" stroke="#8a785c" stroke-width="0.02"/>
      <path d="M${x - r * 0.68} ${y}Q${x} ${y - r * 0.12} ${x + r * 0.68} ${y}Q${x} ${y + r * 0.12} ${x - r * 0.68} ${y}Z" fill="#6e5a40"/>
      <path d="${teeth}" stroke="#f6eedc" stroke-width="0.018"/>
      <ellipse cx="${x - r * 0.3}" cy="${y - r * 0.42}" rx="${r * 0.28}" ry="${r * 0.12}" fill="#fff" opacity="0.6"/>
    </g>`;
}

/** Тёмное семя: боб с рубчиком. */
function seed(x: number, y: number, p: number, r = 0.32): string {
  return `<ellipse cx="${x + 0.04}" cy="${y + 0.06}" rx="${r * 1.05}" ry="${r * 0.9}" fill="url(#fn-sh)"/>
    <g transform="rotate(${tilt(p) + 40} ${x} ${y})">
      <ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.82}" fill="url(#fn-seed)" stroke="#0a0402" stroke-width="0.02"/>
      <path d="M${x - r * 0.15} ${y + r * 0.55}q${r * 0.15} ${r * 0.12} ${r * 0.3} 0" fill="none" stroke="#c8a070" stroke-width="0.035" stroke-linecap="round"/>
      <ellipse cx="${x - r * 0.32}" cy="${y - r * 0.35}" rx="${r * 0.22}" ry="${r * 0.12}" fill="#e8c8a8" opacity="0.4"/>
    </g>`;
}

/** Галька: неровный овал. */
function pebble(x: number, y: number, p: number, white: boolean, r = 0.33): string {
  const a = tilt(p);
  const k = 0.82 + ((p * 13) % 10) / 100;
  return `<ellipse cx="${x + 0.04}" cy="${y + 0.06}" rx="${r * 1.05}" ry="${r * 0.95}" fill="url(#fn-sh)"/>
    <g transform="rotate(${a} ${x} ${y})">
      <path d="M${x - r} ${y}C${x - r} ${y - r * k} ${x + r * 0.8} ${y - r * k * 1.05} ${x + r} ${y - r * 0.1}C${x + r * 1.05} ${y + r * k * 0.9} ${x - r * 0.7} ${y + r * k} ${x - r} ${y}Z"
        fill="url(#fn-peb-${white ? 'w' : 'b'})" stroke="${white ? '#7a766c' : '#000'}" stroke-width="0.02"/>
      <ellipse cx="${x - r * 0.3}" cy="${y - r * 0.4}" rx="${r * 0.25}" ry="${r * 0.12}" fill="#fff" opacity="${white ? 0.7 : 0.25}"/>
    </g>`;
}

function piece(s: State, kind: string, x: number, y: number, p: number): string {
  if (s.cfg.look === 'stone') return pebble(x, y, p, kind === 'w');
  return kind === 'w' ? shell(x, y, p) : seed(x, y, p);
}

/** Действие экрана: выбор подхода/отхода — по любой фишке снимаемой линии. */
type ViewAction = Action & { show?: number };

class FanoronaView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, ViewAction>;
  private info!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="fn-info"></div>`);
    ctx.controls.appendChild(this.info);
    if (!ctx.demo)
      ctx.controls.appendChild(
        h(`<div class="fn-hint">Нажмите на свою фишку и на точку, куда пойти. Взятие обязательно; если можно и подходом и отходом — нажмите на фишку, которую снимаете. Взятая фишка может брать дальше.</div>`)
      );
    this.pb = new PointBoard<State, ViewAction>(
      root,
      ctx,
      {
        count: (s) => geo(s.cfg.size).n,
        size: (s) => [geo(s.cfg.size).w - 1 + 2 * M, geo(s.cfg.size).h - 1 + 2 * M],
        xy: (s, p) => [X(s, p), Y(s, p)],
        board,
        pieces: (s) => s.board.flatMap((v, p) => (v ? [{ p, kind: v === WHITE ? 'w' : 'b' }] : [])),
        piece,
        legal: (s, seat) => {
          if (s.turn !== seat) return [];
          if (s.pend) {
            const { a, w } = s.pend;
            return [...a.map((p) => ({ type: 'pick', at: a[0], show: p }) as ViewAction), ...w.map((p) => ({ type: 'pick', at: w[0], show: p }) as ViewAction)];
          }
          return legal(s);
        },
        spot: (a) => (a.type === 'place' ? { to: a.to } : a.type === 'move' ? { from: a.from, to: a.to } : a.type === 'pick' ? { to: a.show ?? a.at } : null),
        label: () => 'Хватит брать',
        hit: 0.45,
        ring: 0.4,
      },
      'fn-wrap'
    );
    this.pb.extra = (s) => this.marks(s);
  }

  /** Путь цепочки и подписи «подход/отход». */
  private marks(s: State): string {
    let o = '';
    const seen = s.chain?.seen ?? (s.pend ? [...(s.last.length ? s.last.slice(0, -1) : []), s.pend.to] : []);
    if (seen.length > 1) o += `<polyline points="${seen.map((p) => `${X(s, p)},${Y(s, p)}`).join(' ')}" class="fn-path"/>`;
    if (s.pend) {
      const tag = (ps: number[], text: string) => {
        let t = '';
        for (const p of ps) t += `<circle cx="${X(s, p)}" cy="${Y(s, p)}" r="0.42" class="fn-line"/>`;
        const p = ps[ps.length - 1];
        t += `<text x="${X(s, p)}" y="${Y(s, p) - 0.48}" class="fn-tag">${text}</text>`;
        return t;
      };
      o += tag(s.pend.a, 'подход') + tag(s.pend.w, 'отход');
    }
    return o;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const telo = s.cfg.size === 'telo';
    let t = telo
      ? `<div>Белых в запасе: <b>${s.hand[0]}</b> · чёрных: <b>${s.hand[1]}</b></div>`
      : `<div>На доске: белых <b>${count(s, 0)}</b> · чёрных <b>${count(s, 1)}</b></div>`;
    if (s.vela) t += `<small>Вела: ${s.cfg.vela === 0 ? 'белые' : 'чёрные'} только ходят, соперник берёт по одной фишке</small>`;
    if (!telo && s.quiet >= 20 && !s.over) t += `<small>Без взятий ${s.quiet} ходов из 50 — потом ничья</small>`;
    this.info.innerHTML = t;
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    const enemyKind = (seat: number) => (seat === 0 ? 'b' : 'w');
    for (const ev of events) {
      if (ev.type === 'place') {
        this.pb.show(v, null, [], ev.to);
        Sound.place();
        await sleep(240 / this.ctx.speed());
      } else if (ev.type === 'move') {
        const taken = ev.taken.map((p) => ({ p, kind: enemyKind(ev.seat) }));
        this.pb.show(v, { from: ev.from, to: ev.to, kind: ev.seat === 0 ? 'w' : 'b' }, taken);
        if (taken.length) setTimeout(() => Sound.capture(), 200);
        Sound.step();
        await sleep((taken.length ? 560 : 340) / this.ctx.speed());
      } else if (ev.type === 'pick') {
        this.pb.show(v, null, ev.taken.map((p) => ({ p, kind: enemyKind(ev.seat) })));
        Sound.capture();
        await sleep(420 / this.ctx.speed());
      } else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.pb.turn(s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null);
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : `Победа: ${this.ctx.name(v.winner)}`;
    if (!interactive.includes(toAct[0])) return `Ходят ${this.ctx.name(toAct[0])}…`;
    if (v.pend) return 'Что снять — подходом или отходом? Нажмите на фишку';
    if (v.chain) return 'Берите дальше той же фишкой — или «Хватит брать»';
    if (v.cfg.size === 'telo') return v.hand[v.turn] > 0 ? 'Поставьте фишку' : 'Ваш ход';
    const take = legal(v).some((a) => {
      if (a.type !== 'move') return false;
      const c = captures(v, a.from, dirOf(v, a.from, a.to), v.turn);
      return c.a.length + c.w.length > 0;
    });
    return take ? 'Ваш ход — надо брать' : 'Ваш ход';
  }
}

export function createView(): GameView<State, Event> {
  return new FanoronaView();
}
