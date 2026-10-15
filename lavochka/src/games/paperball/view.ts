/* Футбол на бумаге — отрисовка: тетрадный лист в клетку, поле карандашом, ходы «пишутся» синей и красной ручкой.
 * Ход человека — касаниями соседних узлов (допустимые подсвечены); в русском — три касания, штрафной — касание конца удара. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { boardOf, kicks, ruNext, steps, type Event, type State } from './engine';
import { SEATS } from './def';
import './paperball.css';

const NS = 'http://www.w3.org/2000/svg';
const C = 18;

/** Чуть кривая линия «от руки» (детерминированно от координат). */
function wobble(x1: number, y1: number, x2: number, y2: number, amp: number): string {
  const k = Math.sin(x1 * 12.9898 + y1 * 78.233 + x2 * 3.1 + y2 * 1.7) * 43758.5453;
  const r = (k - Math.floor(k)) * 2 - 1;
  const mx = (x1 + x2) / 2 + (y2 - y1) * 0.04 * r * amp;
  const my = (y1 + y2) / 2 - (x2 - x1) * 0.04 * r * amp;
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

class PaperballView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private btns!: HTMLElement;
  private s: State | null = null;
  private actSeat: number | null = null;
  /** Начатая ломаная человека (русский). */
  private path: number[] = [];
  /** Индекс первого «свежего» отрезка в s.lines (рисуется анимацией). */
  private fresh = -1;
  private banner = '';
  /** За экраном только красные — лист перевёрнут, свои ворота внизу (места приходят после mount — смотрим каждый раз). */
  private get flip() {
    const m = this.ctx.mySeats;
    return !this.ctx.demo && m.length === 1 && m[0] === 1;
  }
  private size = '';

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="pb-wrap"><svg class="pb-board" xmlns="${NS}"></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    const ctl = h(`<div class="pb-controls"><div class="pb-btns"></div>${ctx.demo ? '' : '<div class="hint small-hint">Касайтесь подсвеченных узлов — мяч пойдёт туда.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.pb-btns') as HTMLElement;
    this.svg.addEventListener('click', (e) => {
      const t = (e.target as Element).closest('[data-n],[data-k]') as SVGElement | null;
      if (!t) return;
      e.preventDefault();
      this.tap(t.dataset.k != null ? { k: Number(t.dataset.k) } : { n: Number(t.dataset.n) });
    });
  }

  private tap(t: { n?: number; k?: number }) {
    const st = this.s;
    if (!st || this.actSeat == null || st.phase !== 'play') return;
    const seat = this.actSeat;
    Sound.unlock();
    if (t.k != null) {
      if (!st.penalty) return;
      this.done();
      return this.ctx.act(seat, { type: 'kick', dir: t.k });
    }
    const n = t.n!;
    if (!this.targets().includes(n)) return;
    if (st.mode !== 'ru') {
      this.done();
      return this.ctx.act(seat, { type: 'move', path: [n] });
    }
    this.path.push(n);
    Sound.pen(1);
    const b = boardOf(st);
    if (this.path.length === 3 || b.goalSide(n) >= 0) {
      const path = this.path;
      this.done();
      return this.ctx.act(seat, { type: 'move', path });
    }
    this.buttons();
    this.draw();
  }

  /** Куда сейчас можно ткнуть (узлы). */
  private targets(): number[] {
    const st = this.s;
    if (!st || this.actSeat == null || st.phase !== 'play' || st.penalty) return [];
    const b = boardOf(st);
    return st.mode === 'ru' ? ruNext(b, st.ball, this.path) : steps(b, st.ball);
  }

  private done() {
    this.actSeat = null;
    this.path = [];
    this.btns.innerHTML = '';
    this.draw();
  }

  private buttons() {
    this.btns.innerHTML = '';
    const st = this.s;
    if (!st || this.actSeat == null || st.mode !== 'ru' || st.penalty) return;
    const b = h<HTMLButtonElement>(`<button class="btn">Отменить отрезок</button>`);
    b.disabled = !this.path.length;
    b.onclick = () => {
      this.path.pop();
      this.buttons();
      this.draw();
    };
    this.btns.appendChild(b);
  }

  /** Экранные координаты узла. */
  private pt(n: number): [number, number] {
    const st = this.s!;
    const cols = st.W + 1;
    let x = n % cols;
    let y = Math.floor(n / cols) - 1;
    if (this.flip) {
      x = st.W - x;
      y = st.H - y;
    }
    return [(x + 1) * C, (y + 2) * C];
  }

  private draw() {
    const st = this.s;
    if (!st) return;
    const vw = (st.W + 2) * C;
    const vh = (st.H + 4) * C;
    const size = `${vw} ${vh}`;
    if (size !== this.size) {
      this.svg.setAttribute('viewBox', `0 0 ${size}`);
      this.size = size;
    }
    const at = (x: number, y: number) => (y + 1) * (st.W + 1) + x;
    const P = (x: number, y: number) => this.pt(at(x, y));
    let out = `<rect width="${vw}" height="${vh}" class="pb-paper"/>`;
    for (let i = C; i < vw; i += C) out += `<line x1="${i}" y1="0" x2="${i}" y2="${vh}" class="pb-sq"/>`;
    for (let i = C; i < vh; i += C) out += `<line x1="0" y1="${i}" x2="${vw}" y2="${i}" class="pb-sq"/>`;
    // поле: борта карандашом, разрывы ворот; за воротами — сетка
    const seg = (a: [number, number], b: [number, number], cls: string, amp = 0.4) => `<path d="${wobble(a[0], a[1], b[0], b[1], amp)}" class="${cls}"/>`;
    const hockey = st.mode === 'hockey';
    const { W, H, g0, g1 } = st;
    for (const [y, owner] of [[0, 1], [H, 0]] as const) {
      if (hockey) out += seg(P(0, y), P(W, y), 'pb-edge');
      else {
        out += seg(P(0, y), P(g0, y), 'pb-edge') + seg(P(g1, y), P(W, y), 'pb-edge');
        const dy = y === 0 ? -1 : 1;
        const [x0, y0] = P(g0, y);
        const [x1, y1] = P(g1, y + dy);
        const rx = Math.min(x0, x1);
        const ry = Math.min(y0, y1);
        out += `<rect x="${rx}" y="${ry}" width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}" class="pb-net" style="--c:${SEATS[owner].color}"/>`;
        out += seg(P(g0, y), P(g0, y + dy), 'pb-edge') + seg(P(g0, y + dy), P(g1, y + dy), 'pb-edge') + seg(P(g1, y + dy), P(g1, y), 'pb-edge');
      }
      if (hockey) out += `<path d="${wobble(...P(g0, y), ...P(g1, y), 0.2)}" class="pb-goal" style="--c:${SEATS[owner].color}"/>`;
    }
    out += seg(P(0, 0), P(0, H), 'pb-edge') + seg(P(W, 0), P(W, H), 'pb-edge');
    // средняя линия и центр
    out += seg(P(0, H / 2), P(W, H / 2), 'pb-mid', 0.2);
    const [cx, cy] = this.pt(st.center);
    out += `<circle cx="${cx}" cy="${cy}" r="${hockey ? 9 : 2.6}" class="${hockey ? 'pb-ring' : 'pb-dot'}"/>`;
    // подписи ворот — на полях листа, над и под воротами
    for (const owner of [0, 1]) {
      const top = (owner === 1) !== this.flip;
      out += `<text x="${vw / 2}" y="${top ? C * 0.5 : vh - C * 0.5}" class="pb-label" style="fill:${SEATS[owner].color}">ворота ${owner ? 'красных' : 'синих'}</text>`;
    }
    // линии ходов
    const L = st.lines;
    for (let i = 0; i < L.length; i += 4) {
      const a = this.pt(L[i]);
      const b = this.pt(L[i + 1]);
      const fresh = this.fresh >= 0 && i >= this.fresh;
      out += `<path class="pb-ink${fresh ? ' fresh' : ''}${L[i + 3] ? ' kick' : ''}" pathLength="1" d="${wobble(a[0], a[1], b[0], b[1], 1)}" stroke="${SEATS[L[i + 2]].color}"${fresh ? ` style="animation-delay:${((i - this.fresh) / 4) * 0.06}s"` : ''}/>`;
    }
    // начатая ломаная человека
    if (this.actSeat != null && this.path.length) {
      let a = this.pt(st.ball);
      for (const q of this.path) {
        const b = this.pt(q);
        out += `<path class="pb-ink draft" d="${wobble(a[0], a[1], b[0], b[1], 1)}" stroke="${SEATS[this.actSeat].color}"/>`;
        a = b;
      }
    }
    // куда можно
    const mine = this.actSeat != null && st.phase === 'play';
    const col = SEATS[st.turn].color;
    if (mine && st.penalty) {
      const b = boardOf(st);
      const [bx, by] = this.pt(st.ball);
      for (const { dir, path } of kicks(b, st.ball)) {
        const [ex, ey] = this.pt(path[path.length - 1]);
        out += `<path d="M${bx} ${by}L${ex} ${ey}" class="pb-aim" stroke="${col}"/>`;
        out += `<g data-k="${dir}" class="pb-hit"><circle cx="${ex}" cy="${ey}" r="${C * 0.6}" class="pb-hitarea"/><circle cx="${ex}" cy="${ey}" r="5" class="pb-target" style="--c:${col}"/></g>`;
      }
    } else if (mine) {
      for (const n of this.targets()) {
        const [x, y] = this.pt(n);
        out += `<g data-n="${n}" class="pb-hit"><circle cx="${x}" cy="${y}" r="${C * 0.55}" class="pb-hitarea"/><circle cx="${x}" cy="${y}" r="4" class="pb-target" style="--c:${col}"/></g>`;
      }
    }
    // мяч (или шайба)
    const [mx, my] = this.pt(this.actSeat != null && this.path.length ? this.path[this.path.length - 1] : st.ball);
    out += hockey
      ? `<ellipse cx="${mx}" cy="${my}" rx="6" ry="4.6" class="pb-puck"/>`
      : `<g class="pb-ball"><circle cx="${mx}" cy="${my}" r="5.6"/><path d="M${mx - 2} ${my - 2.2}l2 -1.4 2 1.4 -0.8 2.3h-2.4z"/></g>`;
    if (this.banner) {
      const bw = Math.min(vw - 20, 240);
      out += `<g class="pb-banner"><rect x="${vw / 2 - bw / 2}" y="${vh / 2 - 28}" width="${bw}" height="56" rx="6"/><text x="${vw / 2}" y="${vh / 2 + 2}" style="font-size:${Math.min(30, bw / 8)}px">${this.banner}</text></g>`;
    }
    this.svg.innerHTML = out;
  }

  setView(s: State) {
    this.s = s;
    this.fresh = -1;
    this.banner = s.phase === 'over' ? this.overText(s) : '';
    this.draw();
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  private overText(s: State) {
    if (!s.winners) return '';
    return s.winners.length > 1 ? 'Ничья!' : `Победа: ${this.plain(s.winners[0])}!`;
  }

  async play(events: Event[], s: State) {
    const speed = this.ctx.speed();
    this.actSeat = null;
    this.path = [];
    this.btns.innerHTML = '';
    for (const ev of events) {
      const prev = this.s ?? s;
      if (ev.type === 'move' || ev.type === 'kick') {
        let cur = { ...prev, lines: prev.lines.slice() };
        let a = ev.from;
        const per = ev.type === 'kick' ? 70 : 190;
        for (const q of ev.path) {
          cur = { ...cur, lines: [...cur.lines, a, q, ev.seat, ev.type === 'kick' ? 1 : 0], ball: q };
          this.s = cur;
          this.fresh = cur.lines.length - 4;
          this.banner = '';
          this.draw();
          if (ev.type === 'move' || q === ev.path[0]) Sound.pen(1);
          await sleep(per / speed);
          a = q;
        }
        this.s = { ...cur, turn: ev.type === 'move' && ev.bounce ? ev.seat : 1 - ev.seat, penalty: false };
        if (ev.type === 'move' && ev.bounce) {
          Sound.pen(1);
          await sleep(120 / speed);
        }
      } else if (ev.type === 'goal') {
        this.s = { ...prev, score: ev.score };
        this.fresh = -1;
        this.banner = ev.own ? 'Автогол!' : 'Гол!';
        this.draw();
        Sound.home();
        await sleep(1200 / speed);
      } else if (ev.type === 'stuck') {
        this.fresh = -1;
        this.banner = ev.penalty ? 'Нет хода — штрафной!' : 'Нет хода!';
        this.draw();
        Sound.nomove();
        await sleep(1000 / speed);
      } else if (ev.type === 'reset') {
        this.banner = '';
        this.s = { ...prev, ball: prev.center, lines: ev.fresh ? [] : prev.lines, turn: ev.seat };
        this.fresh = -1;
        this.draw();
        if (ev.fresh) Sound.shuffle();
        await sleep(400 / speed);
      } else if (ev.type === 'end') {
        Sound.win();
      }
    }
    this.s = s;
    this.fresh = -1;
    this.banner = s.phase === 'over' ? this.overText(s) : '';
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.actSeat = null;
    this.path = [];
    this.btns.innerHTML = '';
    const st = this.s;
    if (!st || st.phase === 'over' || this.ctx.demo) return this.draw();
    this.actSeat = interactive.find((x) => toAct.includes(x)) ?? null;
    this.buttons();
    this.draw();
  }

  status(st: State, toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    const score = st.goals > 1 ? ` · счёт ${st.score[0]} : ${st.score[1]}` : '';
    if (st.phase === 'over') return (st.winners && st.winners.length === 1 ? `Победа: ${name(st.winners[0])}` : 'Ничья') + score;
    const who = toAct[0];
    const me = interactive.includes(who);
    const L = st.lines;
    const again = st.mode !== 'ru' && L.length >= 4 && L[L.length - 2] === who && st.ball === L[L.length - 3];
    let what: string;
    if (st.penalty) what = me ? 'штрафной — коснитесь конца удара' : 'бьют штрафной';
    else if (st.mode === 'ru') what = me ? 'ломаная из трёх отрезков' : 'ходят';
    else what = again ? 'отскок — ещё ход' : me ? 'отрезок к соседнему узлу' : 'ходят';
    return `${me ? 'Ваш ход' : 'Ход'}: ${name(who)} — ${what}${score}`;
  }

  playerStats(st: State, seat: number) {
    return `<span>голов: ${st.score[seat]}${st.goals > 1 ? ` из ${st.goals}` : ''}</span>`;
  }
}

export function createView(): GameView<State, Event> {
  return new PaperballView();
}
