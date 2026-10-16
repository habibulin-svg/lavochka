/* «Акционеры» — отрисовка: поле картинкой, фишки-пуговицы, флажки владельцев и кубики-предприятия на фирмах, указатель биржи
 * в восьмиугольнике (курсы компаний — жетонами у секторов), забастовка в аэропорту. Карточки «Известие»/«Телекс» и патенты — поверх поля.
 * Касание клетки показывает её текст (у фирмы — цены и прибыль по курсу). В панели — свои деньги, патенты, кредиты, карточки и фирмы
 * (строить, заложить, выкупить — перед своим ходом). */
import { Sound } from '../../core/audio';
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { DiceTray } from '../../core/dice';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { AIR, CELLS, COS, DECK_NAME, EXCHANGE, EXCHANGE_XY, FIELD_H, FIELD_W, PT_COLOR, PT_IDS, PT_NAME, type Deck, type Pt } from './data';
import { SEATS } from './def';
import {
  canBuild,
  canManage,
  capital,
  cardOf,
  entCost,
  firmOf,
  fmt,
  money,
  owned,
  priceOf,
  profitOf,
  rateOf,
  valueOf,
  type Action,
  type Event,
  type State,
} from './engine';
import './akcii.css';

const strip = (s: string) => s.replace(/<[^>]+>/g, '');
const px = (x: number) => (x / FIELD_W) * 100 + '%';
const py = (y: number) => (y / FIELD_H) * 100 + '%';

/** Коротко: 1,2 млн, 350 тыс. */
function short(n: number) {
  if (Math.abs(n) >= 1e6) return String(Math.round(n / 1e5) / 10).replace('.', ',') + ' млн';
  if (Math.abs(n) >= 1e4) return Math.round(n / 1e3) + ' тыс';
  return fmt(n);
}

/** Курс компании подписью: ×2, ÷3, ×4/3. */
function rateLabel(r: [number, number]) {
  if (r[0] === r[1]) return '';
  if (r[1] === 1) return `×${r[0]}`;
  if (r[0] === 1) return `÷${r[1]}`;
  return `×${r[0]}/${r[1]}`;
}

class AkciiView implements GameView<State, Event> {
  private ctx!: ViewCtx<Action>;
  private v: State | null = null;
  private wrap!: HTMLElement;
  private board!: HTMLElement;
  private tokensEl!: HTMLElement;
  private marks!: HTMLElement;
  private pointer!: HTMLElement;
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
  private angle = 0;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="ak-wrap"><div class="ak-board">
        <img class="ak-img" alt="поле" draggable="false" src="/akcii/field.webp">
        <div class="ak-marks"></div>
        <div class="ak-pointer" style="left:${px(EXCHANGE_XY.x)};top:${py(EXCHANGE_XY.y)}"><div class="ak-hand"></div></div>
        <div class="ak-tokens"></div>
      </div>
      <div class="ak-stage bc-ui"></div>
      <div class="ak-tip bc-ui" hidden></div>
      <div class="ak-float"></div></div>`);
    root.appendChild(this.wrap);
    this.board = this.wrap.querySelector('.ak-board') as HTMLElement;
    this.tokensEl = this.wrap.querySelector('.ak-tokens') as HTMLElement;
    this.marks = this.wrap.querySelector('.ak-marks') as HTMLElement;
    this.pointer = this.wrap.querySelector('.ak-pointer') as HTMLElement;
    this.stage = this.wrap.querySelector('.ak-stage') as HTMLElement;
    this.float = this.wrap.querySelector('.ak-float') as HTMLElement;
    this.tip = this.wrap.querySelector('.ak-tip') as HTMLElement;
    this.cam = new BoardCam(this.wrap, this.board, {
      w: FIELD_W,
      h: FIELD_H,
      mini: '/akcii/field-small.webp',
      src: FIELD_W,
      token: 0.04,
      followKey: 'akcii.follow',
      demo: ctx.demo,
      speed: () => this.ctx.speed(),
      dots: () => (this.v ? this.v.seats.filter((s) => !this.v!.out[s]).map((s) => ({ key: s, ...CELLS[this.shown[s] ?? 0], img: `/hodilki/buttons/${s}.webp`, on: this.actor() === s })) : []),
      turn: () => this.turnPoints(),
      moved: () => this.onCam(),
    });
    const img = this.wrap.querySelector('.ak-img') as HTMLImageElement;
    ctx.hold?.(8000);
    const ready = () => {
      this.board.classList.add('ready');
      this.ctx.hold?.(0);
      this.cam.shown();
    };
    if (img.complete && img.naturalWidth) ready();
    else img.onload = ready;
    this.wrap.addEventListener('click', (e) => this.onBoard(e));
    this.panel = h(`<div class="ak-panel">
        <div class="ak-tray"></div>
        <button class="btn primary ak-roll" data-tap hidden>Бросить кубик</button>
        <div class="ak-mine"></div>
      </div>`);
    ctx.controls.appendChild(this.panel);
    this.tray = new DiceTray(this.panel.querySelector('.ak-tray') as HTMLElement, 1);
    this.rollBtn = this.panel.querySelector('.ak-roll') as HTMLButtonElement;
    this.mine = this.panel.querySelector('.ak-mine') as HTMLElement;
    this.rollBtn.onclick = () => this.send({ type: 'roll' });
    this.mine.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (el) this.send({ type: el.dataset.act as 'build', cell: Number(el.dataset.cell) });
    });
  }

  private actor() {
    const v = this.v;
    return v ? (v.ask ? v.ask.seat : v.turn) : -1;
  }

  private turnPoints(): CamPoint[] {
    const v = this.v;
    if (!v || v.result) return [];
    return [CELLS[this.shown[this.actor()] ?? 0]];
  }

  private others(): CamPoint[] {
    const v = this.v!;
    return v.seats.filter((s) => !v.out[s]).map((s) => CELLS[this.shown[s] ?? 0]);
  }

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
    // теневое состояние: владельцы, предприятия и курсы меняются по ходу событий
    const sh: State = this.v
      ? { ...this.v, owner: { ...this.v.owner }, ent: { ...this.v.ent }, mort: { ...this.v.mort }, rate: this.v.rate.map((r) => [r[0], r[1]] as [number, number]), airStrike: this.v.airStrike }
      : v;
    this.v = sh;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.type) {
        case 'roll':
          await this.tray.roll([ev.d], speed);
          if (ev.why) await sleep(350 / speed);
          break;
        case 'move': {
          const path = ev.path.slice();
          const el = this.tokens.get(ev.seat);
          await this.cam.frame([CELLS[this.shown[ev.seat] ?? 0], CELLS[path[path.length - 1]]], this.others());
          el?.classList.add('lifted');
          for (const p of path) {
            this.shown[ev.seat] = p;
            this.placeTokens();
            if (ev.jump) Sound.jump();
            else Sound.step();
            await sleep((ev.jump ? 700 : 170) / speed);
          }
          el?.classList.remove('lifted');
          Sound.place();
          break;
        }
        case 'cell': {
          const c = CELLS[ev.cell];
          if (c.kind === 'patent' || c.kind === 'izv' || c.kind === 'telex' || c.kind === 'firm') break;
          const asked = v.ask && v.ask.seat === ev.seat && v.ask.cell === ev.cell && ![...events.slice(i + 1)].some((e) => e.type === 'move' && e.seat === ev.seat);
          this.placeStage(ev.seat);
          this.stage.innerHTML = `<div class="ak-box ak-show">${cellHtml(this.v, ev.cell)}</div>`;
          Sound.card();
          if (asked) break;
          await sleep(1100 / speed);
          this.stage.textContent = '';
          break;
        }
        case 'patent':
          this.placeStage(ev.seat);
          this.stage.innerHTML = `<div class="ak-box ak-show">${patentHtml(ev.t, ev.v, ev.paid)}</div>`;
          Sound.card();
          this.delta(ev.seat, ev.paid);
          await sleep(1300 / speed);
          this.stage.textContent = '';
          break;
        case 'card': {
          this.placeStage(ev.seat);
          this.stage.innerHTML = `<div class="ak-box ak-show">${cardHtml(ev.deck, ev.i)}</div>`;
          Sound.card();
          const asked = v.ask && v.ask.seat === ev.seat && v.ask.card?.deck === ev.deck && v.ask.card.i === ev.i && !events.slice(i + 1).some((e) => e.type === 'card');
          if (asked) break;
          await (this.ctx.read ? this.ctx.read(2200) : sleep(2200 / speed));
          this.stage.textContent = '';
          break;
        }
        case 'pay':
          if (ev.from != null) this.delta(ev.from, -ev.amount);
          if (ev.to != null) this.delta(ev.to, ev.amount);
          await sleep(300 / speed);
          break;
        case 'pats':
          this.say(`${strip(this.ctx.name(ev.seat))}: ${ev.back ? '+' : '−'}${ev.n} пат. — ${ev.why}`);
          await sleep(900 / speed);
          break;
        case 'credit':
          this.delta(ev.seat, ev.sum);
          Sound.win();
          await sleep(600 / speed);
          break;
        case 'buy':
          sh.owner[ev.cell] = ev.seat;
          this.renderMarks();
          this.delta(ev.seat, -ev.price);
          Sound.place();
          await sleep(600 / speed);
          break;
        case 'build':
          sh.ent[ev.cell] = ev.n;
          this.renderMarks();
          Sound.place();
          await sleep(350 / speed);
          break;
        case 'mortgage':
          sh.mort[ev.cell] = !ev.back;
          this.renderMarks();
          this.delta(ev.seat, ev.back ? -ev.sum : ev.sum);
          await sleep(400 / speed);
          break;
        case 'lose':
          if (ev.why === 'конфискация') sh.owner[ev.cell] = null;
          sh.ent[ev.cell] = 0;
          this.renderMarks();
          await sleep(300 / speed);
          break;
        case 'spin':
          await this.spin(ev.co, ev.k, speed);
          {
            const r = sh.rate[ev.co];
            const m = EXCHANGE[ev.k];
            sh.rate[ev.co] = m > 0 ? [r[0] * m, r[1]] : [r[0], r[1] * -m];
          }
          this.renderMarks();
          break;
        case 'skip':
          if (ev.air) this.say(`${strip(this.ctx.name(ev.seat))} ждёт в аэропорту`);
          await sleep(500 / speed);
          break;
        case 'note':
          if (/забастовка в аэропорту/.test(ev.text)) {
            sh.airStrike = /кончилась/.test(ev.text) ? null : 'izv';
            this.renderMarks();
          }
          this.say(ev.seat == null ? ev.text : `${strip(this.ctx.name(ev.seat))}: ${ev.text}`);
          await sleep(1000 / speed);
          break;
        case 'auction':
          this.say(ev.seat == null ? (ev.bid ? `Аукцион: ${CELLS[ev.cell].name}` : 'Аукцион не состоялся') : `${strip(this.ctx.name(ev.seat))}: ${money(ev.bid)}`);
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
  }

  /** Два вращения указателя: компания (внешний круг), потом изменение курса (внутренний). */
  private async spin(co: number, k: number, speed: number) {
    const c = { x: EXCHANGE_XY.x, y: EXCHANGE_XY.y };
    await this.cam.frame([{ x: c.x - 330, y: c.y - 330 }, { x: c.x + 330, y: c.y + 330 }], []);
    this.pointer.classList.add('on');
    for (const [sector, inner] of [
      [co, false],
      [k, true],
    ] as const) {
      const target = sector * 45;
      const cur = ((this.angle % 360) + 360) % 360;
      this.angle += 720 + ((target - cur + 360) % 360) + (Math.random() * 16 - 8);
      this.pointer.classList.toggle('inner', inner);
      this.pointer.style.setProperty('--rot', `${this.angle}deg`);
      this.pointer.style.transitionDuration = `${1.6 / speed}s`;
      Sound.shuffle();
      await sleep(1700 / speed);
      const m = EXCHANGE[k];
      this.say(inner ? `${COS[co].short}: ${m > 0 ? `курс ×${m}` : `курс ÷${-m}`}` : COS[co].short);
      if (inner) (m > 0 ? Sound.win : Sound.nomove)();
      await sleep(900 / speed);
    }
    this.pointer.classList.remove('on');
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
    if (v.phase === 'roll') return me ? `Бросайте кубик (круг ${v.round} из ${v.rounds})${owned(v, who).some((c) => canBuild(v, who, c)) ? ' — или стройте предприятия' : ''}` : `Ходит ${nm}…`;
    if (v.ask) return me ? esc(v.ask.text) : `${nm} решает…`;
    return '';
  }

  playerStats(v: State, seat: number) {
    if (v.out[seat]) return '<b>банкрот</b>';
    const cap = capital(v, seat);
    const debt = v.loans[seat].reduce((a, l) => a + l.sum, 0);
    const where = v.pos[seat] === AIR ? ' ✈' : '';
    return `<b>${short(v.cash[seat])}</b>${cap ? ` · 🏢${short(cap)}` : ''}${v.pats[seat].length ? ` · 📜${v.pats[seat].length}` : ''}${debt ? ` · <span class="ak-debt">−${short(debt)}</span>` : ''}${where}${v.skip[seat] ? ` ⏸${v.skip[seat]}` : ''}${v.threat[seat] ? ' ⚠' : ''}`;
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
        el = h(`<div class="ak-token" data-seat="${s}"><div class="ak-btn" style="background-image:url(/hodilki/buttons/${s}.webp)"></div></div>`);
        this.tokensEl.appendChild(el);
        this.tokens.set(s, el);
      }
      el.classList.toggle('on', !v.result && this.actor() === s);
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
        const r = n > 1 ? (p === 0 || p === AIR ? 110 : 60 + 10 * (n - 2)) : 0;
        el.style.left = px(c.x + Math.cos(ang) * r);
        el.style.top = py(c.y + Math.sin(ang) * r);
      });
    }
  }

  /** Флажки владельцев с предприятиями, курсы компаний у секторов биржи, забастовка в аэропорту. */
  private renderMarks() {
    const v = this.v!;
    let html = '';
    for (const c of CELLS) {
      if (!c.firm) continue;
      const o = v.owner[c.id];
      if (o == null) continue;
      const ent = v.ent[c.id];
      html += `<div class="ak-own ${v.mort[c.id] ? 'mort' : ''}" style="left:${px(c.x)};top:${py(c.y - 62)};--c:${SEATS[o].color}" title="${esc(c.name)}">${'<i></i>'.repeat(ent)}</div>`;
    }
    v.rate.forEach((r, co) => {
      const t = rateLabel(r);
      if (!t) return;
      const a = ((co * 45 - 90) * Math.PI) / 180;
      const R = EXCHANGE_XY.outer + 10;
      html += `<div class="ak-rate ${r[0] > r[1] ? 'up' : 'down'}" style="left:${px(EXCHANGE_XY.x + Math.cos(a) * R)};top:${py(EXCHANGE_XY.y + Math.sin(a) * R)}">${t}</div>`;
    });
    if (v.airStrike) html += `<div class="ak-strike" style="left:${px(CELLS[AIR].x)};top:${py(CELLS[AIR].y - 120)}">ЗАБАСТОВКА</div>`;
    this.marks.innerHTML = html;
  }

  private me(): number | null {
    const v = this.v!;
    const act = this.actor();
    if (this.interactive.includes(act)) return act;
    return this.ctx.mySeats.find((s) => v.seats.includes(s)) ?? null;
  }

  private renderPanel() {
    const v = this.v!;
    const actor = this.actor();
    const mine = this.interactive.includes(actor);
    const atStop = v.pos[v.turn] === 0 ? !v.fresh[v.turn] : v.pos[v.turn] === 73;
    this.rollBtn.hidden = !(mine && v.phase === 'roll' && !atStop && !v.result && !this.busy && !this.ctx.demo);
    const me = this.me();
    if (me == null || this.ctx.demo || !v.seats.includes(me)) {
      this.mine.innerHTML = this.ratesHtml(v);
      return;
    }
    const manage = mine && actor === me && !this.busy && canManage(v, me);
    const byType = new Map<Pt, number>();
    for (const p of v.pats[me]) byType.set(p.t, (byType.get(p.t) ?? 0) + 1);
    const cards: string[] = [];
    if (v.polis[me]) cards.push('🛡 страховой полис');
    if (v.diploma[me]) cards.push('🎓 диплом менеджера');
    if (v.shadow[me]) cards.push('🕶 теневая экономика');
    if (v.inspector[me]) cards.push('🔎 фининспектор');
    if (v.singer[me]) cards.push('🎤 «Музыка» ×10');
    if (v.gardener[me]) cards.push('🍓 «Дача» ×3');
    if (v.beauty[me]) cards.push('👑 шоу-бизнес за полцены');
    if (v.threat[me]) cards.push(`⚠ угроза банкротства (${v.threat[me]})`);
    if (v.bets.some((b) => b.seat === me)) cards.push('📈 ставка на бирже');
    if (v.relief[me]) cards.push(`🤝 льгота ${fmt(v.relief[me])}`);
    const firms = owned(v, me);
    this.mine.innerHTML = `<div class="ak-cash"><b>${money(v.cash[me])}</b></div>
      <div class="ak-rows">
        <div>Капитал <b>${money(capital(v, me))}</b></div>
        ${v.loans[me].map((l) => `<div class="ak-debt">Кредит <b>${money(l.sum)}</b> — через ${l.left} х.</div>`).join('')}
      </div>
      ${
        v.pats[me].length || v.racket[me].length
          ? `<div class="ak-pats">${PT_IDS.filter((t) => byType.has(t))
              .map((t) => `<span style="--c:${PT_COLOR[t]}">${PT_NAME[t]}${byType.get(t)! > 1 ? ` ×${byType.get(t)}` : ''}</span>`)
              .join('')}${v.racket[me].length ? `<span class="rk">у рэкета ${v.racket[me].length}</span>` : ''}</div>`
          : ''
      }
      ${cards.length ? `<div class="ak-flags">${cards.join(' · ')}</div>` : ''}
      ${
        firms.length
          ? `<div class="ak-firms">${firms
              .map((c) => {
                const f = firmOf(c);
                const btns = manage
                  ? v.mort[c]
                    ? `<button class="btn" data-act="redeem" data-cell="${c}" ${v.cash[me] < valueOf(v, c) ? 'disabled' : ''}>Выкупить ${fmt(valueOf(v, c))}</button>`
                    : `${v.ent[c] < 3 ? `<button class="btn" data-act="build" data-cell="${c}" ${canBuild(v, me, c) ? '' : 'disabled'}>Строить ${fmt(entCost(v, c))}</button>` : ''}<button class="btn" data-act="mortgage" data-cell="${c}">Заложить</button>`
                  : '';
                return `<div class="ak-firm ${v.mort[c] ? 'mort' : ''}"><span>${esc(f.name)} <small>${'■'.repeat(v.ent[c])}${'□'.repeat(3 - v.ent[c])}${v.mort[c] ? ' в залоге' : v.ent[c] ? ` · прибыль ${fmt(profitOf(v, c))}` : ''}</small></span><span class="ak-fb">${btns}</span></div>`;
              })
              .join('')}</div>`
          : ''
      }
      ${this.ratesHtml(v)}`;
  }

  private ratesHtml(v: State) {
    if (!v.exchange) return '';
    const list = v.rate.map((r, co) => [rateLabel(r), co] as const).filter(([t]) => t);
    if (!list.length) return '';
    return `<div class="ak-rateslist">Биржа: ${list.map(([t, co]) => `<span>${esc(COS[co].short)} <b>${t}</b></span>`).join('')}</div>`;
  }

  private renderStage() {
    const v = this.v!;
    const st = this.stage;
    if (v.result) {
      st.innerHTML = `<div class="ak-box"><div class="ak-q big">🏆 ${v.result.winners.map((s) => this.ctx.name(s)).join(', ')}</div>
          <div class="ak-q">${esc(v.result.text)}</div>
          <div class="ak-score">${v.seats
            .slice()
            .sort((a, b) => v.result!.scores[b] - v.result!.scores[a] || v.cash[b] - v.cash[a])
            .map((s) => `<div>${this.ctx.name(s)}<b>${v.out[s] ? 'банкрот' : money(v.result!.scores[s])}</b></div>`)
            .join('')}</div></div>`;
      return;
    }
    const a = v.ask;
    if (!a) {
      st.textContent = '';
      this.placeStage(v.turn);
      return;
    }
    const me = this.interactive.includes(a.seat) && !this.ctx.demo;
    const nm = this.ctx.name(a.seat);
    const card = a.card ? cardHtml(a.card.deck, a.card.i) : a.kind === 'route' ? '' : cellHtml(v, a.cell);
    const btns = me ? `<div class="ak-btns">${a.opts.map((o) => `<button class="btn ${o.main ? 'primary' : ''}" data-id="${esc(o.id)}">${esc(o.label)}</button>`).join('')}</div>` : '';
    this.placeStage(a.seat);
    st.innerHTML = `<div class="ak-box">${card}<div class="ak-q">${a.kind === 'auction' ? `${nm}: ` : ''}${esc(a.text)}</div>${me ? btns : `<div class="ak-wait">${nm} решает…</div>`}</div>`;
    st.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((el) => (el.onclick = () => this.send({ type: 'choose', id: el.dataset.id! })));
  }

  private stageSeat = 0;

  /** Окно решения — в половине поля напротив фишки. */
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

  private onBoard(e: MouseEvent) {
    const v = this.v;
    if (!v || (e.target as HTMLElement).closest('.ak-box, .ak-tip, .bc-cam, .bc-mini')) {
      if ((e.target as HTMLElement).closest('.ak-tip')) this.tip.hidden = true;
      return;
    }
    const { x, y } = this.cam.toImg(e.clientX, e.clientY);
    let best = -1;
    let dist = 120 * 120;
    for (const c of CELLS) {
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
    const o = CELLS[best].firm && v.owner[best] != null ? `<div class="ak-ownline">владелец — ${this.ctx.name(v.owner[best]!)}${v.mort[best] ? ' (в залоге)' : ''}</div>` : '';
    this.tip.innerHTML = `${cellHtml(v, best)}${o}`;
    this.tipCell = best;
    this.tip.hidden = false;
    this.placeTip();
  }

  private send(a: Action) {
    const v = this.v;
    if (!v || this.busy) return;
    const actor = this.actor();
    if (!this.interactive.includes(actor)) return;
    Sound.unlock();
    this.ctx.act(actor, a);
  }

  private say(text: string) {
    const el = h(`<div class="ak-say">${esc(text)}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  private delta(seat: number, n: number) {
    if (!n || !this.v) return;
    const p = this.cam.toScreen(CELLS[this.shown[seat] ?? 0]);
    const el = h(`<div class="ak-delta ${n > 0 ? 'plus' : 'minus'}" style="left:${p.x}px;top:${p.y}px">${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}

/** Карточка клетки; у фирмы — цена, предприятие и прибыль по текущему курсу. */
function cellHtml(v: State | null, id: number) {
  const c = CELLS[id];
  const f = c.firm;
  if (!f) return `<div class="ak-card"><div class="ak-cname">${esc(c.name)}</div><div class="ak-ctext">${esc(c.text)}</div></div>`;
  const r = v ? rateOf(v, f.co) : 1;
  const k = (n: number) => fmt(Math.round((n * r) / 1000) * 1000);
  const rl = v ? rateLabel(v.rate[f.co]) : '';
  const cur = v ? v.ent[id] : 0;
  return `<div class="ak-card firm"><div class="ak-co">${esc(COS[f.co].name)}</div><div class="ak-cname">${esc(f.name)}</div>
    <div class="ak-price">${v ? fmt(priceOf(v, id)) : fmt(f.price)}${rl ? ` <small>(${rl})</small>` : ''}</div>
    <div class="ak-ent">стоимость каждого предприятия <b>${v ? fmt(entCost(v, id)) : fmt(f.ent)}</b></div>
    <div class="ak-prof">${f.profit.map((p, i) => `<div class="${cur === i + 1 ? 'cur' : ''}"><span>${i + 1}</span><b>${k(p)}</b></div>`).join('')}</div></div>`;
}

function patentHtml(t: Pt, v: number, paid: number) {
  return `<div class="ak-patent" style="--c:${PT_COLOR[t]}"><div class="ak-pin"><div class="ak-pname">${PT_NAME[t]}</div><div class="ak-pval">${fmt(v)}</div>${paid !== v ? `<div class="ak-pmul">выплата ${fmt(paid)}</div>` : ''}</div></div>`;
}

function cardHtml(deck: Deck, i: number) {
  return `<div class="ak-news ${deck}"><div class="ak-nhead">${DECK_NAME[deck]}</div><div class="ak-ntext">${esc(cardOf({ deck, i }).text)}</div></div>`;
}

export function createView(): GameView<State, Event> {
  return new AkciiView();
}
