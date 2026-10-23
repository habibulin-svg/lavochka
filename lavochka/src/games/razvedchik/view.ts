/* Разведчик и дозор — отрисовка. Поле — выпрямленный снимок поля из коробки «Малыша» (public/tex/razvedchik/board.webp):
 * лес, белые/жёлтые/красные кружки, тропинки; слева полоса с солдатом, справа — с пионерами.
 * Фишки — сверху: дозорные — бирюзовые конусы с надетыми бумажными кружками-номерами, разведчик — красный конус.
 * До расстановки дозорные ждут на розовой полосе, разведчик — на жёлтой. Ход: касание фишки (своя выбирается сама)
 * и подсвеченного кружка. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { legal, N, owner, PTS, SCOUT, SCOUT_LIMIT, type Action, type Event, type State } from './engine';
import './razvedchik.css';

const TEX = `${import.meta.env.BASE_URL}tex/razvedchik/board.webp`;
const W = 1500;
const H = 1000;

/** Место фишки до расстановки: дозорные — на розовой полосе, разведчик — на жёлтой. */
function tray(piece: number): [number, number] {
  if (piece === SCOUT) return [86, 330];
  return [1424, 120 + (piece - 1) * 132];
}

const xy = (p: number): [number, number] => (p < N ? [PTS[p][0], PTS[p][1]] : tray(p - N));

function defs(): string {
  return `<defs>
    <radialGradient id="rz-teal" cx="38%" cy="34%" r="70%"><stop offset="0" stop-color="#8fe0d2"/><stop offset="0.35" stop-color="#2fa894"/><stop offset="0.8" stop-color="#14705f"/><stop offset="1" stop-color="#0a463c"/></radialGradient>
    <radialGradient id="rz-red" cx="38%" cy="34%" r="70%"><stop offset="0" stop-color="#ffb08a"/><stop offset="0.35" stop-color="#ff4a26"/><stop offset="0.8" stop-color="#c41a08"/><stop offset="1" stop-color="#7a0c02"/></radialGradient>
    <radialGradient id="rz-paper" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#f6eedc"/><stop offset="0.85" stop-color="#e2d4b4"/><stop offset="1" stop-color="#b8a682"/></radialGradient>
    <filter id="rz-sh" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>`;
}

function board(): string {
  return `${defs()}<image href="${TEX}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`;
}

/** Цифры по кругу на бумажном кружке — как на вырезке из коробки. */
function digits(n: number): string {
  let o = '';
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    const x = Math.cos(a) * 24;
    const y = Math.sin(a) * 24;
    o += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${(k * 90 + 135).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" class="rz-dig">${n}</text>`;
  }
  return o;
}

function piece(kind: string, x: number, y: number): string {
  if (kind === 's')
    return `<g transform="translate(${x} ${y})">
      <ellipse cx="9" cy="12" rx="27" ry="24" fill="#000" opacity="0.45" filter="url(#rz-sh)"/>
      <circle r="26" fill="url(#rz-red)" stroke="#5a0800" stroke-width="2"/>
      <circle cx="-3" cy="-4" r="9" fill="#ff8a66" opacity="0.8"/>
      <ellipse cx="-8" cy="-10" rx="6" ry="4" fill="#fff" opacity="0.75"/>
    </g>`;
  const n = Number(kind.slice(1));
  return `<g transform="translate(${x} ${y})">
    <ellipse cx="9" cy="12" rx="38" ry="34" fill="#000" opacity="0.45" filter="url(#rz-sh)"/>
    <circle r="36" fill="url(#rz-paper)" stroke="#6a5a3a" stroke-width="2"/>
    ${digits(n)}
    <circle r="17" fill="url(#rz-teal)" stroke="#06302a" stroke-width="2"/>
    <circle cx="-3" cy="-4" r="6" fill="#bff2e8" opacity="0.6"/>
    <circle cx="-5" cy="-7" r="2.6" fill="#fff" opacity="0.85"/>
  </g>`;
}

const pieceKind = (i: number) => (i === SCOUT ? 's' : `d${i}`);

class RazvedchikView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private hint!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="rz-info"></div>`);
    ctx.controls.appendChild(this.info);
    this.hint = h(`<div class="rz-hint"></div>`);
    if (!ctx.demo) ctx.controls.appendChild(this.hint);
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: (s) => N + s.pos.length,
        size: () => [W, H],
        xy: (_s, p) => xy(p),
        board,
        pieces: (s) => s.pos.map((p, i) => ({ p: p >= 0 ? p : N + i, kind: pieceKind(i) })),
        piece: (_s, kind, x, y) => piece(kind, x, y),
        legal: (s, seat) => (!s.over && owner(s, s.cur) === seat ? legal(s) : []),
        spot: (a) => (a.type === 'move' ? { from: a.from, to: a.to } : { from: N + (this.s ? this.s.cur : 0), to: a.to }),
        hit: 40,
        ring: 38,
      },
      'rz'
    );
  }

  seatName(v: State, seat: number) {
    if (seat === 0) return 'Разведчик';
    const mine: number[] = [];
    for (let i = 1; i <= v.cfg.dozors; i++) if (owner(v, i) === seat) mine.push(i);
    return v.players === 2 ? 'Дозор' : `Дозорн${mine.length > 1 ? 'ые' : 'ый'} №${mine.join(', ')}`;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const order = s.cfg.order === 'box' ? 'все дозорные по номерам, потом разведчик' : 'дозорный — разведчик — следующий дозорный';
    this.info.innerHTML = `<div>Ходов разведчика: <b>${s.scoutMoves}</b> <small>(предел ${SCOUT_LIMIT})</small></div><small>Порядок: ${order}</small>`;
    this.hint.textContent =
      s.phase === 'place'
        ? 'Дозорные встают на свободные красные кружки, разведчик — на жёлтый. Нажмите на подсвеченный кружок.'
        : 'Фишка ходит по линии на соседний свободный кружок. Нажмите на кружок, куда идти.';
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'place') {
        this.s = v;
        this.pb.show(v, { from: N + ev.piece, to: ev.to, kind: pieceKind(ev.piece) });
        Sound.place();
        await sleep(360 / this.ctx.speed());
      } else if (ev.type === 'move') {
        this.s = v;
        this.pb.show(v, { from: ev.from, to: ev.to, kind: pieceKind(ev.piece) });
        Sound.step();
        await sleep(340 / this.ctx.speed());
      } else if (ev.type === 'skip') {
        await sleep(200 / this.ctx.speed());
      } else if (ev.type === 'end') {
        if (ev.winner == null) Sound.nomove();
        else Sound.win();
      }
    }
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.pb.turn(s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null);
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : v.winner === 0 ? 'Разведчик прорвался!' : 'Разведчик окружён!';
    const who = v.cur === SCOUT ? 'разведчик' : `дозорный №${v.cur}`;
    const mine = interactive.includes(toAct[0]);
    if (v.phase === 'place') {
      if (!mine) return `Расстановка: ставит ${who}…`;
      return v.cur === SCOUT ? 'Поставьте разведчика на жёлтый кружок' : `Поставьте дозорного №${v.cur} на красный кружок`;
    }
    if (!mine) return `Ходит ${who}…`;
    return v.cur === SCOUT ? 'Ход разведчика' : `Ход дозорного №${v.cur}`;
  }
}

export function createView(): GameView<State, Event> {
  return new RazvedchikView();
}
