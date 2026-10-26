/* «Полководец» — отрисовка. Поле — три оригинальных листа, сфотографированные и сложенные вместе (public/polkovodec/board.webp,
 * 36×27 клеток по 60 px). Войска — оригинальные карточки с фото россыпи (cards.webp: ряды — русские, французы, австрийцы;
 * 11 родов). Генералы и маршалы — знамёна на подставке (в коробке их ставили на карточку; листа знамён нет — рисуем кодом
 * в цветах армий). Ход: касание фигуры и клетки; приказы тратятся сами, «Закончить ход» — кнопкой. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { col, COST, isCmd, legal, N, NAMES, row, UNITS, type Action, type Event, type Kind, type State } from './engine';
import { COLS, ROWS } from './terrain';
import './polkovodec.css';

const BASE = `${import.meta.env.BASE_URL}polkovodec/`;
const C = 60;
const W = COLS * C;
const H = ROWS * C;
/** Цвета армий: фон карточки и полотнища знамени. */
export const ARMY = [
  { name: 'Русская армия', bg: '#5e7a44', flag: ['#ffffff', '#1f7a3a'] },
  { name: 'Французская армия', bg: '#4a74c4', flag: ['#1a3a9a', '#ffffff', '#c41a1a'] },
  { name: 'Австрийская армия', bg: '#e8e4da', flag: ['#f2d02a', '#111111'] },
];

class PolkovodecView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private shop!: HTMLElement;
  private s: State | null = null;
  private seat: number | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="pk-info"></div>`);
    this.shop = h(`<div class="pk-shop"></div>`);
    ctx.controls.appendChild(this.info);
    ctx.controls.appendChild(this.shop);
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: () => N,
        size: () => [W, H],
        xy: (_s, p) => [col(p) * C + C / 2, row(p) * C + C / 2],
        board: () => `<defs><filter id="pk-sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="2" dy="3" stdDeviation="2" flood-opacity="0.5"/></filter></defs>
          <image href="${BASE}board.webp" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`,
        pieces: (s) => s.pieces.map((p) => ({ p: p.p, kind: `${p.army}:${p.kind}:${s.used.includes(p.id) ? 1 : 0}` })),
        piece: (_s, kind, x, y) => this.card(kind, x, y),
        legal: (s, seat) => legal(s, seat).filter((a) => a.type !== 'recruit'),
        spot: (a) => {
          const s = this.s;
          if (!s || a.type === 'end' || a.type === 'recruit') return null;
          const pc = s.pieces.find((x) => x.id === a.id);
          return pc ? { from: pc.p, to: a.to } : null;
        },
        label: (a) => (a.type === 'end' ? 'Закончить ход' : '…'),
        zoom: true,
        hit: 28,
        ring: 26,
      },
      'pk'
    );
  }

  private card(kind: string, x: number, y: number): string {
    const [a, k, used] = kind.split(':');
    const army = Number(a);
    const S = 52;
    const dim = used === '1' ? ' opacity="0.75"' : '';
    if (isCmd(k as Kind)) {
      const big = k === 'marshal';
      const fl = ARMY[army].flag;
      const fw = big ? 34 : 24;
      const stripes = fl.map((c, i) => `<rect x="${-2}" y="${-22 + (i * (big ? 22 : 16)) / fl.length}" width="${fw}" height="${(big ? 22 : 16) / fl.length}" fill="${c}"/>`).join('');
      return `<g transform="translate(${x} ${y})" filter="url(#pk-sh)"${dim}>
        <ellipse cx="0" cy="20" rx="17" ry="6" fill="#3a2a1a"/><rect x="-3" y="-26" width="3" height="46" fill="#5a3a1a"/>${stripes}
        <rect x="-2" y="-22" width="${fw}" height="${big ? 22 : 16}" fill="none" stroke="#222" stroke-width="1"/>${big ? '<circle cx="-1.5" cy="-28" r="3" fill="#e0b020"/>' : ''}</g>`;
    }
    const i = UNITS.indexOf(k as Kind);
    return `<g filter="url(#pk-sh)"${dim}><svg x="${x - S / 2}" y="${y - S / 2}" width="${S}" height="${S}" viewBox="${i * 160} ${army * 160} 160 160"><image href="${BASE}cards.webp" x="0" y="0" width="1760" height="480"/></svg>
      <rect x="${x - S / 2}" y="${y - S / 2}" width="${S}" height="${S}" fill="none" stroke="#222" stroke-width="1.2"/></g>`;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const side = s.turn;
    const cmds = s.pieces.filter((p) => p.side === side && isCmd(p.kind));
    const left = cmds.filter((c) => !s.used.includes(c.id)).length;
    this.info.innerHTML =
      s.armies
        .map((a, i) => `<div>${this.ctx.name(i)} — ${ARMY[a].name.toLowerCase()}: ${s.alive[i] ? `${s.pieces.filter((p) => p.side === i).length} фигур, склады ${s.stock[i] / 2}, крепостей ${s.forts.filter((f) => f.owner === i).length}` : 'капитулировала'}</div>`)
        .join('') + `<div>Приказов в этот ход: <b>${left}</b> из ${cmds.length}. Ход ${s.turns + 1} из 80.</div>`;
    // формирование в крепости
    this.shop.innerHTML = '';
    if (this.seat === side && !s.over) {
      const rec = legal(s, side).filter((a): a is Extract<Action, { type: 'recruit' }> => a.type === 'recruit');
      const kinds = [...new Set(rec.map((a) => a.kind))];
      if (kinds.length) {
        this.shop.appendChild(h(`<div class="pk-shop-t">Сформировать в крепости:</div>`));
        for (const k of kinds) {
          const a = rec.find((x) => x.kind === k)!;
          const b = h(`<button class="btn pk-btn">${NAMES[k][s.armies[side]]} · ${COST[k] / 2}</button>`);
          b.addEventListener('click', () => this.ctx.act(side, a));
          this.shop.appendChild(b);
        }
      }
    }
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'move' || ev.type === 'hit') {
        const prev = this.s ?? v;
        const pc = prev.pieces.find((x) => x.id === ev.id);
        const kind = pc ? `${pc.army}:${pc.kind}:1` : '';
        this.s = v;
        if (ev.type === 'hit') {
          const art = ev.kind === 'gun' || ev.kind === 'hart';
          this.pb.show(v, art ? null : { from: ev.from, to: ev.to, kind }, [{ p: ev.to, kind: `${ev.took.army}:${ev.took.kind}:0` }]);
          Sound.capture();
        } else {
          this.pb.show(v, { from: ev.from, to: ev.to, kind });
          Sound.step();
        }
        await sleep(320 / this.ctx.speed());
      } else if (ev.type === 'recruit') Sound.place();
      else if (ev.type === 'drown' || ev.type === 'capitulate') Sound.nomove();
      else if (ev.type === 'fort') Sound.home();
      else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.seat = s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    this.pb.turn(this.seat);
    this.text();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : `Победа: ${ARMY[v.armies[v.winner]].name.toLowerCase()}`;
    if (!interactive.some((x) => toAct.includes(x))) return 'Приказы отдаёт соперник…';
    return 'Ваши приказы: фигура и клетка';
  }

  playerStats(v: State, seat: number) {
    return v.alive[seat] ? `${v.pieces.filter((p) => p.side === seat).length} фигур` : 'капитуляция';
  }
}

export function createView(): GameView<State, Event> {
  return new PolkovodecView();
}
