/* «Вестерн» — отрисовка: поле-комикс картинкой, фишки-пуговицы на клетках, флажки владельцев акций, жетоны на биржах поля
 * (труда — фишки игроков, товарной — цены, фондовой — курсы ведущих компаний), кубик у ворот «Начало пути».
 * Решения — поверх поля; на «Угоне самолёта» клетку выбирают касанием поля. Касание клетки показывает её текст.
 * В панели стола — свои деньги, долги, товары и акции (продать банку по номиналу). */
import { Sound } from '../../core/audio';
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { DiceTray } from '../../core/dice';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { CELLS, CO, FIELD_H, FIELD_W, GOOD_IDS, GOODS, GOODS_XY, LABOUR, LEAD, STOCK_XY } from './data';
import { SEATS } from './def';
import { coValue, fmt, goodPrice, money, owned, walkTarget, worth, type Action, type Event, type State } from './engine';
import './western.css';

const strip = (s: string) => s.replace(/<[^>]+>/g, '');
const px = (x: number) => (x / FIELD_W) * 100 + '%';
const py = (y: number) => (y / FIELD_H) * 100 + '%';

class WesternView implements GameView<State, Event> {
  private ctx!: ViewCtx<Action>;
  private v: State | null = null;
  private wrap!: HTMLElement;
  private board!: HTMLElement;
  private tokensEl!: HTMLElement;
  private marks!: HTMLElement;
  private stage!: HTMLElement;
  private float!: HTMLElement;
  private tip!: HTMLElement;
  private panel!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private mine!: HTMLElement;
  private tray!: DiceTray;
  private tokens = new Map<number, HTMLElement>();
  private shown: number[] = [];
  private interactive: number[] = [];
  private busy = false;
  private cam!: BoardCam;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="ww-wrap"><div class="ww-board">
        <img class="ww-img" alt="поле" draggable="false" src="/western/field.webp">
        <div class="ww-marks"></div>
        <div class="ww-tokens"></div>
      </div>
      <div class="ww-stage bc-ui"></div>
      <div class="ww-tip bc-ui" hidden></div>
      <div class="ww-float"></div></div>`);
    root.appendChild(this.wrap);
    this.board = this.wrap.querySelector('.ww-board') as HTMLElement;
    this.tokensEl = this.wrap.querySelector('.ww-tokens') as HTMLElement;
    this.marks = this.wrap.querySelector('.ww-marks') as HTMLElement;
    this.stage = this.wrap.querySelector('.ww-stage') as HTMLElement;
    this.float = this.wrap.querySelector('.ww-float') as HTMLElement;
    this.tip = this.wrap.querySelector('.ww-tip') as HTMLElement;
    this.cam = new BoardCam(this.wrap, this.board, {
      w: FIELD_W,
      h: FIELD_H,
      mini: '/western/field.webp',
      src: 11428,
      token: 0.034,
      followKey: 'western.follow',
      demo: ctx.demo,
      speed: () => this.ctx.speed(),
      dots: () => (this.v ? this.v.seats.filter((s) => !this.v!.out[s]).map((s) => ({ key: s, ...CELLS[this.shown[s] ?? 0], img: `/hodilki/buttons/${s}.webp`, on: this.actor() === s })) : []),
      turn: () => this.turnPoints(),
      spots: () => {
        const to = this.moveTo();
        return to != null ? [CELLS[to]] : [];
      },
      moved: () => this.onCam(),
    });
    const img = this.wrap.querySelector('.ww-img') as HTMLImageElement;
    ctx.hold?.(8000);
    const ready = () => {
      this.board.classList.add('ready');
      this.ctx.hold?.(0);
      this.cam.shown();
    };
    if (img.complete && img.naturalWidth) ready();
    else img.onload = ready;
    this.wrap.addEventListener('click', (e) => this.onBoard(e));
    this.panel = h(`<div class="ww-panel">
        <div class="ww-tray"></div>
        <button class="btn primary ww-roll" data-tap hidden>Бросить кубик</button>
        <div class="ww-mine"></div>
      </div>`);
    ctx.controls.appendChild(this.panel);
    this.tray = new DiceTray(this.panel.querySelector('.ww-tray') as HTMLElement, 1);
    this.rollBtn = this.panel.querySelector('.ww-roll') as HTMLButtonElement;
    this.mine = this.panel.querySelector('.ww-mine') as HTMLElement;
    this.rollBtn.onclick = () => this.send({ type: 'roll' });
    this.mine.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-sell]') as HTMLElement | null;
      if (el) this.send({ type: 'sell', cell: Number(el.dataset.sell) });
    });
  }

  private actor() {
    const v = this.v;
    return v ? (v.ask ? v.ask.seat : v.turn) : -1;
  }

  /** Что показать на ход: фишка того, кто ходит (и клетка, куда её ставить). */
  private turnPoints(): CamPoint[] {
    const v = this.v;
    if (!v || v.result) return [];
    const to = v.phase === 'move' ? walkTarget(v) : null;
    return [CELLS[this.shown[this.actor()] ?? 0], ...(to != null ? [CELLS[to]] : [])];
  }

  /** Остальные фишки — тоже в кадре по возможности. */
  private others(): CamPoint[] {
    const v = this.v!;
    return v.seats.filter((s) => !v.out[s]).map((s) => CELLS[this.shown[s] ?? 0]);
  }

  /** Камера сдвинулась: окно решения и подсказка живут в экранных координатах. */
  private onCam() {
    if (!this.v) return;
    if (this.stage.firstChild) this.placeStage(this.stageSeat);
    if (!this.tip.hidden) this.placeTip();
  }

  setView(v: State) {
    this.v = v;
    this.shown = v.pos.slice();
    if (v.dice) this.tray.show([v.dice]);
    this.render();
  }

  async play(events: Event[], v: State) {
    const speed = this.ctx.speed();
    this.busy = true;
    this.stage.textContent = '';
    this.tip.hidden = true;
    // теневое состояние: биржи и владельцы меняются по ходу событий
    const sh = this.v ? { ...this.v, owner: { ...this.v.owner }, pts: { ...this.v.pts }, gp: { ...this.v.gp }, labour: this.v.labour.slice() } : v;
    this.v = sh;
    const lastCell = [...events].reverse().find((e) => e.type === 'cell');
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.type) {
        case 'roll': {
          // кадр «откуда — куда», пока катится кубик
          const to = v.turn === ev.seat ? walkTarget(v) : null;
          if (to != null) void this.cam.frame([CELLS[this.shown[ev.seat] ?? 0], CELLS[to]], this.others());
          await this.tray.roll([ev.d], speed);
          break;
        }
        case 'move': {
          // соседние шаги одного игрока — одним движением
          const path = ev.path.slice();
          let jump = !!ev.jump;
          while (!jump && events[i + 1]?.type === 'move' && (events[i + 1] as typeof ev).seat === ev.seat && !(events[i + 1] as typeof ev).jump) {
            path.push(...(events[++i] as typeof ev).path);
          }
          const el = this.tokens.get(ev.seat);
          const ahead = path.map((p) => CELLS[p]);
          await this.cam.frame([CELLS[this.shown[ev.seat] ?? 0], ahead[ahead.length - 1]], this.others());
          el?.classList.add('lifted');
          for (const p of path) {
            this.shown[ev.seat] = p;
            this.placeTokens();
            if (jump) Sound.jump();
            else Sound.step();
            await sleep((jump ? 600 : 170) / speed);
          }
          el?.classList.remove('lifted');
          Sound.place();
          jump = false;
          break;
        }
        case 'cell': {
          const asked = ev === lastCell && v.ask && v.ask.seat === ev.seat && v.ask.cell === ev.cell;
          this.placeStage(ev.seat);
          this.stage.innerHTML = `<div class="ww-box ww-show">${cellHtml(ev.cell)}</div>`;
          Sound.card();
          if (asked) break;
          const quiet = CO[ev.cell] || ev.cell === 1 || ev.cell === 30 || ev.cell === 6;
          if (quiet) await sleep(900 / speed);
          else await (this.ctx.read ? this.ctx.read(1500) : sleep(1500 / speed));
          this.stage.textContent = '';
          break;
        }
        case 'pay':
          if (ev.from != null) this.delta(ev.from, -ev.amount);
          if (ev.to != null) this.delta(ev.to, ev.amount);
          await sleep(260 / speed);
          break;
        case 'gold':
          this.delta(ev.seat, ev.kg, ' кг');
          await sleep(300 / speed);
          break;
        case 'lap':
          this.say(`${strip(this.ctx.name(ev.seat))}: круг ${ev.circle} — ${ev.lost ? 'доход остаётся в банке' : '+' + money(ev.income)}`);
          Sound.win();
          await sleep(900 / speed);
          break;
        case 'labour':
          sh.labour[ev.seat] = ev.labour;
          this.renderMarks();
          await sleep(400 / speed);
          break;
        case 'stock':
          sh.pts[ev.cell] = ev.pts;
          this.renderMarks();
          await sleep(400 / speed);
          break;
        case 'price':
          sh.gp[ev.good] = ev.pts;
          this.renderMarks();
          await sleep(400 / speed);
          break;
        case 'buy':
          sh.owner[ev.cell] = ev.seat;
          this.renderMarks();
          Sound.place();
          await sleep(500 / speed);
          break;
        case 'sell':
          sh.owner[ev.cell] = null;
          this.renderMarks();
          this.delta(ev.seat, ev.price);
          await sleep(500 / speed);
          break;
        case 'jail':
          if (ev.n) this.say(`${strip(this.ctx.name(ev.seat))}: пропуск ${ev.n} ${ev.n < 5 ? 'хода' : 'ходов'}`);
          await sleep(700 / speed);
          break;
        case 'casino':
          await this.tray.roll([ev.d], speed);
          this.say(ev.win ? `Шестёрка! +${money(ev.bet * 9)}` : `${ev.d} — ставка пропала`);
          if (ev.win) Sound.win();
          await sleep(900 / speed);
          break;
        case 'auction':
          this.say(ev.seat == null ? (ev.bid ? `Торги: ${CO[ev.cell].name}` : 'Торги не состоялись') : `${strip(this.ctx.name(ev.seat))}: ${money(ev.bid)}`);
          await sleep(700 / speed);
          break;
        case 'bankrupt':
          this.say(`${strip(this.ctx.name(ev.seat))} — банкрот!`);
          Sound.nomove();
          await sleep(1200 / speed);
          break;
        case 'end':
          Sound.win();
          break;
      }
    }
    this.v = v;
    this.shown = v.pos.slice();
    this.busy = false;
    this.render();
    // своя фишка ждёт перестановки — в кадре она и подсвеченная клетка
    const to = this.moveTo();
    if (to != null) {
      this.cam.release();
      void this.cam.frame([CELLS[this.shown[v.turn] ?? 0], CELLS[to]], this.others());
    }
  }

  setTurn(_toAct: number[], interactive: number[]) {
    const mine = interactive.length > 0 && !this.interactive.length;
    this.interactive = interactive;
    this.render();
    if (mine && this.v) {
      this.cam.release();
      void this.cam.frame(this.turnPoints(), this.others());
    }
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.result) return `${v.result.winners.map((s) => this.ctx.name(s)).join(', ')}: ${v.result.text}!`;
    const who = toAct[0];
    const me = interactive.includes(who);
    const nm = this.ctx.name(who);
    if (v.phase === 'roll') return me ? `Бросайте кубик (круг ${v.circle[who] + 1} из ${v.circles})` : `Ходит ${nm}…`;
    if (v.phase === 'move') return me ? `Выпало ${v.dice} — переставьте свою фишку на подсвеченную клетку` : `${nm} переставляет фишку…`;
    if (v.ask) return me ? esc(v.ask.text) : `${nm} решает…`;
    return '';
  }

  playerStats(v: State, seat: number) {
    if (v.out[seat]) return '<b>банкрот</b>';
    const cos = owned(v, seat).length;
    const debt = v.debt[seat] + v.loan[seat] + v.colLoan[seat];
    return `<b>${fmt(v.cash[seat])} $</b> · круг ${Math.min(v.circle[seat] + 1, v.circles)}/${v.circles}${cos ? ` · акций ${cos}` : ''}${debt ? ` · <span class="ww-debt">долг ${fmt(debt)}</span>` : ''}${v.skip[seat] ? ` · ⛓${v.skip[seat]}` : ''}`;
  }

  destroy() {
    this.cam.destroy();
  }

  // ---------- отрисовка ----------

  private render() {
    const v = this.v;
    if (!v) return;
    this.syncTokens();
    this.placeTokens();
    this.renderMarks();
    if (!this.busy) this.renderStage();
    this.renderPanel();
  }

  private syncTokens() {
    const v = this.v!;
    for (const s of v.seats) {
      let el = this.tokens.get(s);
      if (!el) {
        el = h(`<div class="ww-token" data-seat="${s}"><div class="ww-btn" style="background-image:url(/hodilki/buttons/${s}.webp)"></div></div>`);
        this.tokensEl.appendChild(el);
        this.tokens.set(s, el);
      }
      const act = v.ask ? v.ask.seat : v.turn;
      el.classList.toggle('on', !v.result && act === s);
      el.classList.toggle('out', v.out[s]);
    }
  }

  private placeTokens() {
    const v = this.v!;
    const by = new Map<number, number[]>();
    for (const s of v.seats) {
      const p = this.shown[s] ?? 0;
      by.set(p, [...(by.get(p) ?? []), s]);
    }
    for (const [p, ss] of by) {
      const c = CELLS[p];
      ss.forEach((s, k) => {
        const el = this.tokens.get(s)!;
        const n = ss.length;
        const ang = (k / n) * Math.PI * 2 - Math.PI / 2;
        const r = n > 1 ? (p === 0 ? 140 : 105 + 15 * (n - 2)) : 0;
        el.style.left = px(c.x + Math.cos(ang) * r);
        el.style.top = py(c.y + Math.sin(ang) * r);
      });
    }
  }

  /** Фаза хода у этого экрана: клетка, на которую игрок ставит свою фишку; иначе null. */
  private moveTo(): number | null {
    const v = this.v;
    if (!v || this.busy || this.ctx.demo || v.phase !== 'move' || !this.interactive.includes(v.turn)) return null;
    return walkTarget(v);
  }

  /** Флажки владельцев на клетках акций и жетоны бирж; клетка, куда ставить свою фишку. */
  private renderMarks() {
    const v = this.v!;
    let html = '';
    const to = this.moveTo();
    if (to != null) html += `<div class="ww-to" style="left:${px(CELLS[to].x)};top:${py(CELLS[to].y)}"></div>`;
    for (const key of Object.keys(CO)) {
      const c = Number(key);
      const o = v.owner[c];
      if (o == null) continue;
      const cell = CELLS[c];
      html += `<div class="ww-flag" style="left:${px(cell.x + 70)};top:${py(cell.y - 80)};--c:${SEATS[o].color}" title="${esc(CO[c].name)}"></div>`;
    }
    if (!v.simple) {
      for (const s of v.seats) {
        if (v.out[s]) continue;
        html += `<div class="ww-lab" style="left:${px(LABOUR.x[s])};top:${py(LABOUR.y(v.labour[s]))};--c:${SEATS[s].color}"></div>`;
      }
    }
    for (const g of GOOD_IDS) {
      const [x, y] = GOODS_XY[g];
      const d = v.gp[g];
      html += `<div class="ww-tag ${d > 0 ? 'up' : d < 0 ? 'down' : ''}" style="left:${px(x)};top:${py(y)}">${fmt(goodPrice(v, g))}</div>`;
    }
    for (const c of LEAD) {
      const [x, y] = STOCK_XY[c];
      const d = v.pts[c];
      const o = v.owner[c];
      html += `<div class="ww-tag stock ${d > 0 ? 'up' : d < 0 ? 'down' : ''}" style="left:${px(x)};top:${py(y)};${o != null ? `--c:${SEATS[o].color}` : ''}">${fmt(coValue(v, c))}</div>`;
    }
    this.marks.innerHTML = html;
  }

  private me(): number | null {
    const v = this.v!;
    const act = v.ask ? v.ask.seat : v.turn;
    if (this.interactive.includes(act)) return act;
    return this.ctx.mySeats.find((s) => v.seats.includes(s)) ?? null;
  }

  private renderPanel() {
    const v = this.v!;
    const actor = v.ask ? v.ask.seat : v.turn;
    const mine = this.interactive.includes(actor);
    this.rollBtn.hidden = !(mine && v.phase === 'roll' && !v.result && !this.busy && !this.ctx.demo);
    const me = this.me();
    if (me == null || this.ctx.demo || !v.seats.includes(me)) {
      this.mine.innerHTML = this.ratesHtml(v);
      return;
    }
    const canSell = mine && actor === me && !this.busy && !v.result;
    const cos = owned(v, me);
    const goods = [
      ...GOOD_IDS.map((g) => [g === 'gold' ? v.gold[me] : v.stuff[me][g], GOODS[g].name, GOODS[g].unit] as const),
      [v.stuff[me].drugs, 'наркотик', 'т'] as const,
      [v.stuff[me].trinkets, 'безделушки', 'шт.'] as const,
    ].filter(([n]) => n > 0);
    const flags: string[] = [];
    const F: Record<string, string> = { bribe: '👮 подкуп полиции', free: '🧾 без налогов', bank37: '🏦 доход круга — банку', strike: '✊ забастовка', crop: '🌾 неурожай', press: '📰 кризис прессы', army: '🪖 армия', star: '⭐ ставка на звезду' };
    for (const f of v.flags[me]) flags.push(F[f]);
    if (v.brains[me].length) flags.push(`🧠 вклад золотом ×${v.brains[me].length}`);
    this.mine.innerHTML = `<div class="ww-cash"><b>${fmt(v.cash[me])} $</b> наличными</div>
      <div class="ww-rows">
        ${v.dep[me] ? `<div>Вклад <b>${money(v.dep[me])}</b></div>` : ''}
        ${v.debt[me] ? `<div class="ww-debt">Кредит <b>${money(v.debt[me])}</b></div>` : ''}
        ${v.loan[me] ? `<div class="ww-debt">Ссуда <b>${money(v.loan[me])}</b></div>` : ''}
        ${v.colLoan[me] ? `<div class="ww-debt">Колониальный заём <b>${money(v.colLoan[me])}</b></div>` : ''}
        <div>Капитал <b>${money(worth(v, me))}</b></div>
      </div>
      ${flags.length ? `<div class="ww-flags">${flags.join(' · ')}</div>` : ''}
      ${goods.length ? `<div class="ww-sub">Товары: ${goods.map(([n, name, unit]) => `${name} ${n} ${unit}`).join(', ')}</div>` : ''}
      ${
        cos.length
          ? `<div class="ww-sub">Акции:</div><div class="ww-cos">${cos
              .map(
                (c) => `<div class="ww-co"><span>${esc(CO[c].name)}<small>прибыль ${fmt(CO[c].profit)}</small></span>
                  ${canSell ? `<button class="btn" data-sell="${c}" title="Продать банку по номиналу">${fmt(coValue(v, c))}</button>` : `<b>${fmt(coValue(v, c))}</b>`}</div>`
              )
              .join('')}</div>`
          : ''
      }
      ${this.ratesHtml(v)}`;
  }

  private ratesHtml(v: State) {
    return `<div class="ww-rates">${GOOD_IDS.map((g) => `<span>${GOODS[g].name} <b>${fmt(goodPrice(v, g))}</b></span>`).join('')}</div>`;
  }

  private renderStage() {
    const v = this.v!;
    const st = this.stage;
    if (v.result) {
      st.innerHTML = `<div class="ww-box"><div class="ww-q big">🏆 ${v.result.winners.map((s) => this.ctx.name(s)).join(', ')}</div>
          <div class="ww-score">${v.seats
            .slice()
            .sort((a, b) => v.result!.scores[b] - v.result!.scores[a])
            .map((s) => `<div>${this.ctx.name(s)}<b>${v.out[s] ? 'банкрот' : money(v.result!.scores[s])}</b></div>`)
            .join('')}</div></div>`;
      return;
    }
    const a = v.ask;
    if (!a) {
      st.textContent = '';
      return;
    }
    const me = this.interactive.includes(a.seat) && !this.ctx.demo;
    const nm = this.ctx.name(a.seat);
    const card = a.kind === 'fork' || a.kind === 'offer' || a.kind === 'auction' ? '' : cellHtml(a.kind === 'goto' ? 13 : a.cell);
    let btns = '';
    if (me) {
      const opts = a.kind === 'goto' ? a.opts.filter((o) => o.main || o.id === '85' || o.id === '91') : a.opts;
      btns = `<div class="ww-btns">${opts.map((o) => `<button class="btn ${o.main ? 'primary' : ''}" data-id="${esc(o.id)}">${esc(o.label)}</button>`).join('')}</div>`;
      if (a.kind === 'goto') btns = `<div class="ww-hint">Коснитесь любой клетки на поле — или:</div>${btns}`;
    }
    const who = a.kind === 'offer' ? `${nm}: ` : '';
    this.placeStage(a.seat);
    st.innerHTML = `<div class="ww-box">${card}<div class="ww-q">${who}${esc(a.text)}</div>${me ? btns : `<div class="ww-wait">${nm} решает…</div>`}</div>`;
    st.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((el) => (el.onclick = () => this.send({ type: 'choose', id: el.dataset.id! })));
    this.board.classList.toggle('picking', me && a.kind === 'goto');
  }

  /** Окно решения — в четверти поля напротив фишки, чтобы её не закрывать. */
  private stageSeat = 0;

  private placeStage(seat: number) {
    this.stageSeat = seat;
    const p = this.cam.toScreen(CELLS[this.shown[seat] ?? 0]);
    this.stage.classList.toggle('top', p.y > this.wrap.clientHeight / 2);
    this.stage.classList.toggle('right', p.x < this.wrap.clientWidth / 2);
  }

  private tipCell = 0;

  private placeTip() {
    const p = this.cam.toScreen(CELLS[this.tipCell]);
    const w = this.wrap.clientWidth;
    this.tip.style.left = Math.max(150, Math.min(w - 150, p.x)) + 'px';
    this.tip.style.top = p.y + 'px';
    this.tip.classList.toggle('below', p.y < this.wrap.clientHeight / 2);
  }

  /** Касание поля: на «Угоне самолёта» — выбор клетки, иначе — показать текст клетки. */
  private onBoard(e: MouseEvent) {
    const v = this.v;
    if (!v || (e.target as HTMLElement).closest('.ww-box, .ww-tip, .bc-cam, .bc-mini')) {
      if ((e.target as HTMLElement).closest('.ww-tip')) this.tip.hidden = true;
      return;
    }
    const { x, y } = this.cam.toImg(e.clientX, e.clientY);
    let best = -1;
    let dist = 200 * 200;
    for (const c of CELLS) {
      if (c.id === 0) continue;
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < dist) {
        dist = d;
        best = c.id;
      }
    }
    if (best < 0) {
      this.tip.hidden = true;
      return;
    }
    // бросок сделан — фишку ставят щелчком по подсвеченной клетке
    if (best === this.moveTo()) {
      this.tip.hidden = true;
      this.send({ type: 'move' });
      return;
    }
    const a = v.ask;
    if (a && a.kind === 'goto' && this.interactive.includes(a.seat) && !this.busy && a.opts.some((o) => o.id === String(best))) {
      this.send({ type: 'choose', id: String(best) });
      return;
    }
    const c = CELLS[best];
    const o = CO[best] && v.owner[best] != null ? `<div class="ww-own">владелец — ${this.ctx.name(v.owner[best]!)}</div>` : '';
    this.tip.innerHTML = `${cellHtml(best)}${o}`;
    this.tipCell = c.id;
    this.tip.hidden = false;
    this.placeTip();
  }

  private send(a: Action) {
    const v = this.v;
    if (!v || this.busy) return;
    const actor = v.ask ? v.ask.seat : v.turn;
    if (!this.interactive.includes(actor)) return;
    Sound.unlock();
    this.ctx.act(actor, a);
  }

  private say(text: string) {
    const el = h(`<div class="ww-say">${esc(text)}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  private delta(seat: number, n: number, unit = ' $') {
    if (!n || !this.v) return;
    const p = this.cam.toScreen(CELLS[this.shown[seat] ?? 0]);
    const el = h(`<div class="ww-delta ${n > 0 ? 'plus' : 'minus'}" style="left:${p.x}px;top:${p.y}px">${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}${unit}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}

/** Карточка клетки: номер, название, текст. */
function cellHtml(id: number) {
  const c = CELLS[id];
  const co = CO[id];
  return `<div class="ww-card"><div class="ww-num">${id}</div><div class="ww-cname">${esc(c.name)}</div><div class="ww-ctext">${esc(c.text)}</div>${
    co ? `<div class="ww-price"><span>стоит <b>${fmt(co.price)}</b></span><span>прибыль <b>${fmt(co.profit)}</b></span></div>` : ''
  }</div>`;
}

export function createView(): GameView<State, Event> {
  return new WesternView();
}
