/* «Мо-но-пол» — отрисовка: поле — скан оригинала с камерой (приближение, миникарта), пуговицы игроков на клетках, в подвале,
 * на колесе, на дорожке бегов и в тазиках бани; на купленных фирмах — цветной «ЖЕТОН» хозяина и вложенные банкноты; касса
 * игровых автоматов — с суммой. Решения (покупка, кредит, ставка, рынок, подвал) — кнопками в боковой панели; клетки,
 * которые можно выбрать, подсвечиваются на поле. */
import { Sound } from '../../core/audio';
import { BoardCam } from '../../core/boardcam';
import { DiceTray } from '../../core/dice';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { BATH, BATH_XY, cellarXY, cellAt, CELLAR_W, FH, FIRMS, FW, KASSA, RACE, RACE_XY, WHEEL_XY } from './board';
import { SEATS } from './def';
import { bankOf, debtOf, firmsOf, legal, loanLimit, marketCost, realPrice, rentOf, worth, type Action, type Event, type State } from './engine';
import './monopol.css';

const fmt = (n: number) => n.toLocaleString('ru-RU');
const center = (loc: number) => {
  const c = cellAt(loc);
  return { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 };
};
const pct = (x: number, y: number) => `left:${(x / FW) * 100}%;top:${(y / FH) * 100}%`;

class MonopolView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private wrap!: HTMLElement;
  private board!: HTMLElement;
  private marks!: HTMLElement;
  private hot!: HTMLElement;
  private tokensEl!: HTMLElement;
  private cam!: BoardCam;
  private tray!: DiceTray;
  private info!: HTMLElement;
  private acts!: HTMLElement;
  private v: State | null = null;
  private tokens = new Map<number, HTMLElement>();
  private me: number | null = null;
  private stake = 100;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="mp-wrap">
        <div class="mp-board">
          <img class="mp-img" alt="поле «Мо-но-пол»" draggable="false" src="/monopol/field.webp">
          <div class="mp-marks"></div>
          <div class="mp-hot"></div>
          <div class="mp-tokens"></div>
        </div>
      </div>`);
    root.appendChild(this.wrap);
    this.board = this.wrap.querySelector('.mp-board') as HTMLElement;
    this.marks = this.wrap.querySelector('.mp-marks') as HTMLElement;
    this.hot = this.wrap.querySelector('.mp-hot') as HTMLElement;
    this.tokensEl = this.wrap.querySelector('.mp-tokens') as HTMLElement;
    this.cam = new BoardCam(this.wrap, this.board, {
      w: FW,
      h: FH,
      mini: '/monopol/field-mini.webp',
      token: 0.03,
      followKey: 'monopol.follow',
      demo: ctx.demo,
      speed: () => this.ctx.speed(),
      dots: () => (this.v ? this.v.alive.flatMap((a, s) => (a ? [{ key: s, ...this.pt(this.v!, s), img: `/hodilki/buttons/${s}.webp`, on: this.v!.turn === s }] : [])) : []),
      turn: () => (this.v && !this.v.over ? [this.pt(this.v, this.v.turn)] : []),
    });
    const img = this.wrap.querySelector('.mp-img') as HTMLImageElement;
    const ready = () => {
      this.board.classList.add('ready');
      this.ctx.hold?.(0);
      this.cam.shown();
    };
    if (img.complete) ready();
    else {
      this.ctx.hold?.(8000);
      img.onload = ready;
    }

    const panel = h(`<div class="mp-panel"><div class="mp-tray"></div><div class="mp-acts"></div><div class="mp-info"></div></div>`);
    ctx.controls.appendChild(panel);
    this.tray = new DiceTray(panel.querySelector('.mp-tray') as HTMLElement, 1);
    this.acts = panel.querySelector('.mp-acts') as HTMLElement;
    this.info = panel.querySelector('.mp-info') as HTMLElement;
    this.acts.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b) return;
      e.preventDefault();
      const a = JSON.parse(b.dataset.act!) as Action;
      if (a.type === 'bet') a.amount = this.stake;
      this.send(a);
    });
    this.acts.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.name === 'stake') this.stake = Number(t.value);
    });
    this.hot.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      this.send(JSON.parse(el.dataset.act!) as Action);
    });
  }

  private send(a: Action) {
    const seat = this.me;
    if (seat == null || !this.v || this.v.turn !== seat) return;
    Sound.unlock();
    this.me = null;
    this.ctx.act(seat, a);
    this.renderActs();
    this.renderHot();
  }

  /** Где стоит пуговица игрока (на клетке — со сдвигом, чтобы не закрывать друг друга). */
  private pt(v: State, seat: number) {
    const w = v.where[seat];
    if (w === 'cellar') {
      const [x, y] = cellarXY(Math.floor(v.sub[seat] / CELLAR_W), v.sub[seat] % CELLAR_W);
      return { x, y };
    }
    if (w === 'wheel') return { x: WHEEL_XY[v.sub[seat]][0], y: WHEEL_XY[v.sub[seat]][1] };
    if (w === 'race' && v.sub[seat] >= 0) return { x: RACE_XY[v.sub[seat]][0], y: RACE_XY[v.sub[seat]][1] };
    if (w === 'bath' && v.sub[seat] > 0) return { x: BATH_XY[v.sub[seat] - 1][0], y: BATH_XY[v.sub[seat] - 1][1] };
    const loc = w === 'race' ? RACE : w === 'bath' ? BATH : v.loc[seat];
    const c = center(loc);
    const others = v.alive.flatMap((a, s) => (a && v.where[s] === v.where[seat] && v.loc[s] === v.loc[seat] && (w === 'board' || w === 'bath') ? [s] : []));
    const i = others.indexOf(seat);
    if (others.length < 2 || i < 0) return c;
    const dx = ((i % 3) - 1) * 34;
    const dy = (Math.floor(i / 3) - 0.5) * 34;
    return { x: c.x + dx, y: c.y + dy };
  }

  private renderTokens(v: State) {
    for (let s = 0; s < v.n; s++) {
      let el = this.tokens.get(s);
      if (!v.alive[s]) {
        el?.remove();
        this.tokens.delete(s);
        continue;
      }
      if (!el) {
        el = h(`<img class="mp-token" alt="" draggable="false" src="/hodilki/buttons/${s}.webp">`);
        this.tokensEl.appendChild(el);
        this.tokens.set(s, el);
      }
      const p = this.pt(v, s);
      el.setAttribute('style', pct(p.x, p.y));
      el.classList.toggle('on', v.turn === s && !v.over);
    }
  }

  private renderMarks(v: State) {
    let o = '';
    for (const l of FIRMS) {
      const own = v.owner[l];
      if (own < 0) continue;
      const c = cellAt(l);
      const look = SEATS[own];
      o += `<div class="mp-jeton" style="${pct((c.x0 + c.x1) / 2, c.y0 + 18)};--c:${look.color};--t:${own === 0 || own === 3 ? '#222' : '#fff'}">ЖЕТОН${v.inv[l] ? `<b>+${fmt(v.inv[l])}</b>` : ''}</div>`;
    }
    const k = center(KASSA);
    if (v.pot) o += `<div class="mp-pot" style="${pct(k.x, k.y + 30)}">${fmt(v.pot)}</div>`;
    this.marks.innerHTML = o;
  }

  /** Подсветка клеток, которые можно выбрать (любая клетка, фирмы рынка, клетки подвала). */
  private renderHot() {
    const v = this.v;
    let o = '';
    if (v && this.me != null && v.turn === this.me && !v.over) {
      for (const a of legal(v)) {
        if (a.type === 'pick' || ((v.phase === 'market' || v.phase === 'free') && a.type === 'buy')) {
          const c = cellAt(a.loc);
          o += `<div class="mp-spot" data-act='${JSON.stringify(a)}' style="left:${(c.x0 / FW) * 100}%;top:${(c.y0 / FH) * 100}%;width:${((c.x1 - c.x0) / FW) * 100}%;height:${((c.y1 - c.y0) / FH) * 100}%"></div>`;
        } else if (a.type === 'go' && a.cell >= 0) {
          const [x, y] = cellarXY(Math.floor(a.cell / CELLAR_W), a.cell % CELLAR_W);
          o += `<div class="mp-spot sq" data-act='${JSON.stringify(a)}' style="left:${((x - 26) / FW) * 100}%;top:${((y - 26) / FH) * 100}%;width:${(52 / FW) * 100}%;height:${(52 / FH) * 100}%"></div>`;
        }
      }
    }
    this.hot.innerHTML = o;
  }

  private renderInfo(v: State) {
    let o = '';
    for (let s = 0; s < v.n; s++) {
      const d = debtOf(v, s);
      o += `<div class="mp-p${v.alive[s] ? '' : ' out'}${v.turn === s && !v.over ? ' on' : ''}"><i style="background:${SEATS[s].color}"></i><b>${this.ctx.name(s)}</b>
        <span>${v.alive[s] ? `${fmt(v.cash[s])} бнк${d ? `, долг ${fmt(d)}` : ''}, фирм ${firmsOf(v, s).length} · состояние ${fmt(worth(v, s))}` : 'разорился'}</span></div>`;
    }
    o += `<div class="mp-round">Круг ${Math.min(v.round, v.cfg.rounds || v.round)}${v.cfg.rounds ? ` из ${v.cfg.rounds}` : ''} · касса автоматов: ${fmt(v.pot)}</div>`;
    this.info.innerHTML = o;
  }

  private btn(a: Action, text: string, cls = '') {
    return `<button class="btn ${cls}" data-act='${JSON.stringify(a)}'${a.type === 'roll' ? ' data-tap' : ''}>${text}</button>`;
  }

  private renderActs() {
    const v = this.v;
    if (!v || this.me == null || v.turn !== this.me || v.over) {
      this.acts.innerHTML = '';
      return;
    }
    const seat = this.me;
    const L = legal(v);
    const cash = v.cash[seat];
    let o = '';
    switch (v.phase) {
      case 'turn': {
        o += this.btn({ type: 'roll' }, v.where[seat] === 'bath' ? 'Бросить кубик — по тазикам' : 'Бросить кубик', 'primary');
        const mine = firmsOf(v, seat);
        if (mine.length) {
          o += `<details class="mp-inv"><summary>Вложить в фирмы (наличные: ${fmt(cash)})</summary>`;
          for (const l of mine) {
            o += `<div class="mp-row"><span>${esc(cellAt(l).name)} <small>${fmt(realPrice(v, l))}, платят ${fmt(rentOf(v, l))}</small></span>`;
            for (const a of L) if (a.type === 'invest' && a.loc === l) o += this.btn(a, `+${a.amount}`, 'small');
            const sh = L.find((a) => a.type === 'shift' && a.from === l);
            if (sh) o += this.btn(sh, '100 →', 'small');
            o += `</div>`;
          }
          o += `</details>`;
        }
        break;
      }
      case 'buy': {
        const l = v.loc[seat];
        const c = cellAt(l);
        o += `<div class="mp-q">«${esc(c.name)}»: цена ${fmt(c.price ?? 0)}, с попавшего — 1/${c.den}</div>`;
        for (const a of L) o += a.type === 'buy' ? this.btn(a, `Купить за ${fmt(c.price ?? 0)}`, 'primary') : this.btn(a, 'Не покупать');
        break;
      }
      case 'bank': {
        const b = bankOf(v.loc[seat]);
        const d = v.debt[seat][b];
        const name = b === 0 ? 'Папина' : 'Мамина';
        if (L.some((a) => a.type === 'interest')) {
          o += `<div class="mp-q">${name} сберкнижка: долг ${fmt(d)}. Верните весь долг или заплатите процент.</div>`;
          o += this.btn({ type: 'interest' }, `Процент: ${fmt(Math.max(1, Math.floor(d / (cellAt(v.loc[seat]).den ?? 10))))}`);
          if (L.some((a) => a.type === 'repay')) o += this.btn({ type: 'repay' }, `Вернуть ${fmt(d)}`, 'primary');
        } else {
          o += `<div class="mp-q">${name} сберкнижка: можно взять до ${fmt(loanLimit(v, seat))}.</div><div class="mp-row wrap">`;
          for (const a of L) if (a.type === 'loan') o += this.btn(a, fmt(a.amount), 'small');
          o += `</div>` + this.btn({ type: 'pass' }, 'Не брать');
        }
        break;
      }
      case 'roulette': {
        const opts = [50, 100, 200, 500, 1000, 2000, 5000].filter((x) => x <= cash);
        if (!opts.includes(this.stake)) this.stake = opts[0] ?? 0;
        o += `<div class="mp-q">Рулетка: ставка <select name="stake">${opts.map((x) => `<option value="${x}"${x === this.stake ? ' selected' : ''}>${fmt(x)}</option>`).join('')}${cash > 5000 ? `<option value="${cash}">все ${fmt(cash)}</option>` : ''}</select> — на число:</div><div class="mp-row wrap">`;
        for (let n = 1; n <= 6; n++) o += this.btn({ type: 'bet', amount: this.stake, num: n }, String(n), 'small');
        o += `</div>` + this.btn({ type: 'pass' }, 'Не играть');
        break;
      }
      case 'pick':
        o += `<div class="mp-q">Лотерея: выберите любую клетку поля (нажмите на неё).</div>`;
        break;
      case 'free':
      case 'market': {
        o += `<div class="mp-q">${v.phase === 'market' ? 'Рижский рынок: можно купить любые фирмы, даже занятые.' : 'Можно купить любую свободную фирму.'}</div><div class="mp-list">`;
        for (const a of L) if (a.type === 'buy') o += this.btn(a, `${esc(cellAt(a.loc).name)} — ${fmt(marketCost(v, a.loc))}${v.owner[a.loc] >= 0 ? ` (у ${this.ctx.name(v.owner[a.loc])})` : ''}`, 'small');
        o += `</div>` + this.btn({ type: 'pass' }, v.phase === 'market' ? 'Хватит' : 'Не покупать');
        break;
      }
      case 'cellar':
        o += `<div class="mp-q">Подвал: бросок ${v.rolls + 1} из 6.</div>` + this.btn({ type: 'roll' }, 'Бросить кубик', 'primary');
        break;
      case 'cellarGo':
        o += `<div class="mp-q">Выпало ${v.die}: выберите клетку подвала.</div>`;
        if (L.some((a) => a.type === 'go' && a.cell < 0)) o += this.btn({ type: 'go', cell: -1 }, 'Выйти из подвала', 'primary');
        break;
      case 'wheel':
        o += `<div class="mp-q">Белка в колесе: бегите до пустого сектора.</div>` + this.btn({ type: 'roll' }, 'Бросить кубик', 'primary');
        break;
      case 'race':
        o += `<div class="mp-q">Тараканьи бега: набрано ${v.sum >= 0 ? '+' : '−'}${fmt(Math.abs(v.sum))}.</div>` + this.btn({ type: 'roll' }, 'Бросить кубик', 'primary');
        break;
    }
    this.acts.innerHTML = o;
  }

  private render() {
    const v = this.v;
    if (!v) return;
    this.renderTokens(v);
    this.renderMarks(v);
    this.renderInfo(v);
    this.renderActs();
    this.renderHot();
  }

  setView(v: State) {
    this.v = v;
    if (v.die) this.tray.show([v.die]);
    this.render();
  }

  async play(events: Event[], v: State) {
    const sp = () => this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'roll') {
        await this.tray.roll([ev.die], sp());
      } else if (ev.type === 'bet') {
        await this.tray.roll([ev.die], sp());
        if (ev.win) Sound.win();
      } else if (ev.type === 'move') {
        const el = this.tokens.get(ev.seat);
        if (!el) continue;
        await this.cam.frame([center(ev.path[0]), center(ev.path[ev.path.length - 1])]);
        for (const loc of ev.path.slice(1)) {
          const c = center(loc);
          el.setAttribute('style', pct(c.x, c.y));
          Sound.step();
          await sleep(170 / sp());
        }
      } else if (ev.type === 'jump') {
        const el = this.tokens.get(ev.seat);
        if (!el) continue;
        const tmp: State = { ...v, where: v.where.slice(), sub: v.sub.slice(), loc: v.loc.slice() };
        tmp.where[ev.seat] = ev.where;
        tmp.sub[ev.seat] = ev.sub;
        tmp.loc[ev.seat] = ev.to;
        const p = this.pt(tmp, ev.seat);
        await this.cam.frame([p]);
        el.setAttribute('style', pct(p.x, p.y));
        Sound.jump();
        await sleep(300 / sp());
      } else if (ev.type === 'buy') {
        Sound.place();
        this.renderMarks(v);
        await sleep(250 / sp());
      } else if (ev.type === 'rent' || (ev.type === 'money' && ev.delta < 0)) {
        Sound.capture();
        await sleep(200 / sp());
      } else if (ev.type === 'pot' || ev.type === 'loan' || (ev.type === 'money' && ev.delta > 0)) {
        Sound.home();
        await sleep(160 / sp());
      } else if (ev.type === 'end') Sound.win();
    }
    this.v = v;
    this.render();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    this.me = v && !v.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    if (v && !v.over && this.cam && !this.ctx.demo) {
      this.cam.release();
      void this.cam.frame([this.pt(v, v.turn)]);
    }
    this.render();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Поровну' : `Победа: ${this.ctx.name(v.winner)}`;
    if (!interactive.includes(toAct[0])) return `Ходит ${this.ctx.name(toAct[0])}…`;
    const p = v.phase;
    return p === 'turn' ? 'Ваш ход — бросайте кубик' : p === 'buy' ? 'Покупать фирму?' : p === 'bank' ? 'Сберкнижка' : p === 'roulette' ? 'Рулетка: делайте ставку' : p === 'pick' ? 'Выберите клетку' : p === 'cellarGo' ? 'Выберите клетку подвала' : 'Ваше решение';
  }

  destroy() {
    this.cam?.destroy();
  }
}

export function createView(): GameView<State, Event> {
  return new MonopolView();
}

