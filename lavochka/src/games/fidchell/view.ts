/* Фидхел — отрисовка. Всё кодом: резное дерево (процедурная текстура), по кайме — плетёнка в три ленты с переплетением
 * «над — под», в углах — узлы-трикветры в кольце.
 * «Баллиндерри»: поле с 49 лунками, центральная обведена кругом, угловые — дугами (как на доске из Баллиндерри);
 * фишки — колышки с круглыми шляпками. «Резная»: прорезанные клетки, на троне — трискель, в Ланнахе на углах — узлы.
 * Фишки: бронза — литой диск с выпуклым трискелем, кость — диск из кости с резными «кольцами с точкой»,
 * король — золотой, с узлом-трикветром. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { woodTexture, type WoodKind } from '../../core/wood';
import { interlace, plait, ringDot, triquetra, triskele } from './celtic';
import { BRONZE, isCorner, KING, legal, N, RULES, THRONE, type Action, type Event, type State } from './engine';
import './fidchell.css';

const F = 1.3; // кайма с плетёнкой
const W = N + 2 * F;
/** Тис — тёплое красноватое дерево с частыми кольцами. */
const YEW: WoodKind = {
  light: [176, 106, 58],
  dark: [128, 66, 30],
  deep: [74, 34, 12],
  rings: 0.05,
  stretch: 0.02,
  fiber: 0.35,
};
let yew = '';

const cx = (p: number) => F + (p % N) + 0.5;
const cy = (p: number) => F + Math.floor(p / N) + 0.5;

function defs(): string {
  return `<defs>
    ${yew ? `<pattern id="fd-wood" patternUnits="userSpaceOnUse" width="${W}" height="${W}"><image href="${yew}" width="${W}" height="${W}" preserveAspectRatio="none"/></pattern>` : ''}
    <radialGradient id="fd-bronze" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#ffd890"/><stop offset="0.35" stop-color="#c88a3e"/><stop offset="0.8" stop-color="#7a4818"/><stop offset="1" stop-color="#3e220a"/></radialGradient>
    <radialGradient id="fd-bone" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fffaf0"/><stop offset="0.5" stop-color="#eadcbc"/><stop offset="0.9" stop-color="#c4ae84"/><stop offset="1" stop-color="#8e7650"/></radialGradient>
    <radialGradient id="fd-gold" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fff6c0"/><stop offset="0.4" stop-color="#e8c050"/><stop offset="0.85" stop-color="#9a6e14"/><stop offset="1" stop-color="#5a3c06"/></radialGradient>
    <radialGradient id="fd-hole" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#0c0502"/><stop offset="0.7" stop-color="#1e0e05"/><stop offset="1" stop-color="#4a2410"/></radialGradient>
    <radialGradient id="fd-sh" cx="50%" cy="50%" r="50%"><stop offset="0.5" stop-color="#000" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>`;
}

const wood = () => (yew ? 'url(#fd-wood)' : '#9a5a2c');
/** Лента резьбы: само дерево, тёмная подрезка по краям, блик сверху. */
const ribbon = () => ({
  w: 0.15,
  edge: 0.03,
  fill: wood(),
  stroke: '#1a0a03',
  shine: 'rgba(255,220,170,0.28)',
  shadow: 'rgba(0,0,0,0.35)',
});

const cache = new Map<string, string>();

function board(s: State): string {
  const key = `${s.cfg.look}|${s.cfg.kind}|${yew ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let o = defs();
  // доска и подрезанная кайма
  o += `<rect x="0" y="0" width="${W}" height="${W}" rx="0.12" fill="${wood()}" stroke="#1e0c04" stroke-width="0.06"/>`;
  o += `<rect x="0" y="0" width="${W}" height="${W}" rx="0.12" fill="#2a1206" opacity="0.18"/>`;
  const m = 0.14; // бортик снаружи
  const bi = F - 0.12; // внутренний край каймы
  o += `<path d="M${m} ${m}H${W - m}V${W - m}H${m}Z M${bi} ${bi}V${W - bi}H${W - bi}V${bi}Z" fill="#1a0a03" opacity="0.62" fill-rule="evenodd"/>`;
  o += `<path d="M${m} ${m}H${W - m}V${W - m}H${m}Z" fill="none" stroke="rgba(255,220,170,0.25)" stroke-width="0.03" transform="translate(0.02 0.03)"/>`;
  // плетёнка вдоль сторон (концы уходят под угловые узлы)
  const mid = (m + bi) / 2;
  const H = bi - m;
  const a = F - 0.2;
  const curves = [...plait(a, mid, W - a, mid, H, 3), ...plait(a, W - mid, W - a, W - mid, H, 3), ...plait(mid, a, mid, W - a, H, 3), ...plait(W - mid, a, W - mid, W - a, H, 3)];
  o += interlace(curves, ribbon());
  // угловые квадраты с узлом в кольце
  for (const [x, y] of [
    [m, m],
    [W - bi, m],
    [m, W - bi],
    [W - bi, W - bi],
  ]) {
    const S = bi - m;
    o += `<rect x="${x - 0.02}" y="${y - 0.02}" width="${S + 0.04}" height="${S + 0.04}" fill="${wood()}"/>`;
    o += `<rect x="${x}" y="${y}" width="${S}" height="${S}" fill="#1a0a03" opacity="0.62" stroke="#1a0a03" stroke-width="0.04"/>`;
    o += interlace(triquetra(x + S / 2, y + S / 2 + 0.03, S * 0.44, true), {
      ...ribbon(),
      w: 0.11,
      edge: 0.025,
    });
  }
  // поле
  o += `<rect x="${F - 0.06}" y="${F - 0.06}" width="${N + 0.12}" height="${N + 0.12}" fill="none" stroke="#1a0a03" stroke-width="0.06"/>`;
  o += `<rect x="${F - 0.06}" y="${F - 0.06}" width="${N + 0.12}" height="${N + 0.12}" fill="none" stroke="rgba(255,220,170,0.3)" stroke-width="0.025" transform="translate(0.03 0.04)"/>`;
  const corners = RULES[s.cfg.kind].escape === 'corner';
  if (s.cfg.look === 'ballinderry') {
    // процарапанные линии между лунками
    let g = '';
    for (let i = 0; i < N; i++) g += `M${F + 0.5} ${F + i + 0.5}H${F + N - 0.5}M${F + i + 0.5} ${F + 0.5}V${F + N - 0.5}`;
    o += `<path d="${g}" stroke="rgba(255,220,170,0.18)" stroke-width="0.03" transform="translate(0.015 0.02)"/><path d="${g}" stroke="#1a0a03" stroke-width="0.025" opacity="0.7"/>`;
    // центр — в круге, углы — дугами
    const cc = F + N / 2;
    o += `<circle cx="${cc}" cy="${cc}" r="0.42" fill="none" stroke="#1a0a03" stroke-width="0.05"/><circle cx="${cc}" cy="${cc}" r="0.42" fill="none" stroke="rgba(255,220,170,0.25)" stroke-width="0.02" transform="translate(0.02 0.03)"/>`;
    for (const [x, y, sx, sy] of [
      [F, F, 1, 1],
      [F + N, F, -1, 1],
      [F, F + N, 1, -1],
      [F + N, F + N, -1, -1],
    ]) {
      for (const r of [0.85, 0.98]) o += `<path d="M${x + sx * r} ${y}A${r} ${r} 0 0 ${sx * sy > 0 ? 1 : 0} ${x} ${y + sy * r}" fill="none" stroke="#1a0a03" stroke-width="0.04"/>`;
    }
    for (let p = 0; p < N * N; p++) {
      const x = cx(p);
      const y = cy(p);
      o += `<circle cx="${x}" cy="${y}" r="0.16" fill="url(#fd-hole)"/><path d="M${x - 0.15} ${y + 0.06}A0.16 0.16 0 0 0 ${x + 0.15} ${y + 0.06}" stroke="rgba(255,220,170,0.35)" stroke-width="0.02" fill="none"/>`;
    }
  } else {
    let g = '';
    for (let i = 0; i <= N; i++) g += `M${F + i} ${F}V${F + N}M${F} ${F + i}H${F + N}`;
    // клетки слегка утоплены: тёмная прорезь и светлая грань
    o += `<path d="${g}" stroke="rgba(255,220,170,0.3)" stroke-width="0.04" transform="translate(0.02 0.03)"/><path d="${g}" stroke="#1a0a03" stroke-width="0.055"/>`;
    for (let p = 0; p < N * N; p++) {
      const x = F + (p % N);
      const y = F + Math.floor(p / N);
      if ((p + Math.floor(p / N)) % 2) o += `<rect x="${x + 0.03}" y="${y + 0.03}" width="0.94" height="0.94" fill="#2a1206" opacity="0.14"/>`;
    }
    const tc = cx(THRONE);
    o += `<path d="${triskele(tc, cy(THRONE), 0.36, -Math.PI / 2)}" stroke="rgba(255,220,170,0.3)" stroke-width="0.05" fill="none" stroke-linecap="round" transform="translate(0.02 0.03)"/>`;
    o += `<path d="${triskele(tc, cy(THRONE), 0.36, -Math.PI / 2)}" stroke="#1a0a03" stroke-width="0.05" fill="none" stroke-linecap="round"/>`;
    if (corners)
      for (let p = 0; p < N * N; p++)
        if (isCorner(p))
          o += interlace(triquetra(cx(p), cy(p) + 0.02, 0.36, false), {
            w: 0.06,
            edge: 0.018,
            fill: wood(),
            stroke: '#1a0a03',
            shine: 'rgba(255,220,170,0.3)',
          });
  }
  if (yew) cache.set(key, o);
  return o;
}

function piece(s: State, kind: string, x: number, y: number): string {
  const R = kind === 'k' ? 0.42 : 0.37;
  const peg = s.cfg.look === 'ballinderry';
  let o = `<circle cx="${x + 0.06}" cy="${y + 0.09}" r="${R + 0.04}" fill="url(#fd-sh)"/>`;
  if (kind === 'b') {
    o += `<circle cx="${x}" cy="${y + 0.05}" r="${R}" fill="#3a1e08"/><circle cx="${x}" cy="${y}" r="${R}" fill="url(#fd-bronze)" stroke="#3a1e08" stroke-width="0.02"/>`;
    o += `<circle cx="${x}" cy="${y}" r="${R * 0.84}" fill="none" stroke="#5a3410" stroke-width="0.025"/><circle cx="${x}" cy="${y}" r="${R * 0.84}" fill="none" stroke="#ffe0a0" stroke-opacity="0.45" stroke-width="0.015" transform="translate(-0.012 -0.016)"/>`;
    const t = triskele(x, y, R * 0.66, -Math.PI / 2, 1.35);
    o += `<path d="${t}" stroke="#3e220a" stroke-width="0.07" fill="none" stroke-linecap="round" transform="translate(0.012 0.02)"/>`;
    o += `<path d="${t}" stroke="#e8b060" stroke-width="0.045" fill="none" stroke-linecap="round"/>`;
    o += `<path d="${t}" stroke="#fff0c0" stroke-opacity="0.6" stroke-width="0.015" fill="none" stroke-linecap="round" transform="translate(-0.01 -0.012)"/>`;
  } else if (kind === 'w') {
    o += `<circle cx="${x}" cy="${y + 0.05}" r="${R}" fill="#8e7650"/><circle cx="${x}" cy="${y}" r="${R}" fill="url(#fd-bone)" stroke="#8e7650" stroke-width="0.02"/>`;
    o += `<circle cx="${x}" cy="${y}" r="${R * 0.86}" fill="none" stroke="#6a5430" stroke-width="0.015"/>`;
    o += ringDot(x, y, 0.07, '#5a4424', 0.018);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      o += ringDot(x + Math.cos(a) * R * 0.52, y + Math.sin(a) * R * 0.52, 0.055, '#5a4424', 0.016);
    }
    // волокна кости
    o += `<path d="M${x - R * 0.6} ${y - R * 0.2}q${R * 0.5} ${-R * 0.08} ${R * 1.1} ${R * 0.05}M${x - R * 0.5} ${y + R * 0.3}q${R * 0.4} ${R * 0.06} ${R} ${-R * 0.04}" stroke="#a8946c" stroke-width="0.008" fill="none" opacity="0.6"/>`;
  } else {
    o += `<circle cx="${x}" cy="${y + 0.06}" r="${R}" fill="#5a3c06"/><circle cx="${x}" cy="${y}" r="${R}" fill="url(#fd-gold)" stroke="#5a3c06" stroke-width="0.025"/>`;
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      o += `<circle cx="${x + Math.cos(a) * R * 0.88}" cy="${y + Math.sin(a) * R * 0.88}" r="0.022" fill="#fff2b0" stroke="#7a5410" stroke-width="0.006"/>`;
    }
    o += interlace(triquetra(x, y + 0.01, R * 0.74, true), {
      w: 0.05,
      edge: 0.014,
      fill: '#f4d878',
      stroke: '#6a4808',
      shine: 'rgba(255,255,230,0.55)',
    });
  }
  if (peg) o += `<circle cx="${x - R * 0.35}" cy="${y - R * 0.45}" r="${R * 0.18}" fill="#fff" opacity="0.18"/>`;
  return o;
}

class FidchellView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="fd-info"></div>`);
    ctx.controls.appendChild(this.info);
    if (!ctx.demo) ctx.controls.appendChild(h(`<div class="fd-hint">Нажмите на свою фишку, потом на клетку по прямой. Чужую фишку берут, зажав с двух сторон.</div>`));
    this.pb = new PointBoard<State, Action>(root, ctx, {
      count: () => N * N,
      size: () => [W, W],
      xy: (_s, p) => [cx(p), cy(p)],
      board,
      pieces: (s) => s.board.flatMap((v, p) => (v ? [{ p, kind: v === BRONZE ? 'b' : v === KING ? 'k' : 'w' }] : [])),
      piece: (s, kind, x, y) => piece(s, kind, x, y),
      legal: (s, seat) => (s.turn === seat ? legal(s) : []),
      spot: (a) => ({ from: a.from, to: a.to }),
      hit: 0.5,
      ring: 0.44,
    });
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const r = RULES[s.cfg.kind];
    const goal = !r.king ? 'Оставьте сопернику одну фишку' : r.escape === 'corner' ? 'Король ходит по шагу и уходит в угол' : 'Король уходит на любой край';
    this.info.innerHTML = `<div>Взято: бронзы <b>${s.lost[0]}</b>, кости <b>${s.lost[1]}</b></div><small>${goal}</small>`;
  }

  setView(v: State) {
    this.s = v;
    if (!yew) yew = woodTexture(YEW, 512, 21, false);
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'move') {
        const kind = ev.piece === BRONZE ? 'b' : ev.piece === KING ? 'k' : 'w';
        const taken = ev.taken.map((p) => ({
          p,
          kind: ev.seat === 0 ? 'w' : 'b',
        }));
        this.pb.show(v, { from: ev.from, to: ev.to, kind }, taken);
        Sound.step();
        if (taken.length) setTimeout(() => Sound.capture(), 280);
        await sleep((taken.length ? 560 : 360) / this.ctx.speed());
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
    if (v.over) {
      if (v.winner == null) return 'Ничья';
      if (!RULES[v.cfg.kind].king) return `Победа: ${this.ctx.name(v.winner)}`;
      return v.winner === 1 ? 'Король ушёл' : 'Король взят';
    }
    return interactive.includes(toAct[0]) ? 'Ваш ход' : `Ходит ${this.ctx.name(toAct[0])}…`;
  }
}

export function createView(): GameView<State, Event> {
  return new FidchellView();
}
