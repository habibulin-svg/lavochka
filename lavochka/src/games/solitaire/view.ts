/* «Пасьянсы» — отрисовка: зелёное сукно, карты — общая сцена CardStage (cards/stage.ts).
 * Карту тянут мышью или пальцем; простое нажатие — карта сама идёт в лучшее место (в дом, если можно);
 * в пирамиде нажатие выбирает карту, второе — пару к ней. Ключ карты — её номер в раздаче, поэтому полёт и переворот выходят сами. */
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck, deckStyle } from '../../cards/render';
import { CardStage, CH, CW, type StageItem } from '../../cards/stage';
import { SUIT_SYM } from '../../cards/deck';
import { bestTarget, upRun, type Board, type Ctx, type Move } from './engine';
import { convergence, ctxFor, GAME_LABEL, hasLevel, LEVELS, seedKey, type Action, type Event, type View } from './def';
import { geoOf, LAND, PORT, type Geo } from './layout';
import { hint } from './solver';
import { cascade, type Launch } from './cascade';
import './solitaire.css';

/** Рекорды на этом устройстве: по пасьянсу с настройками. */
export interface Record_ {
  title: string;
  played: number;
  won: number;
  best: number;
  bestMoves: number;
}
export const RECORDS = 'solitaire.records';

export function variantText(v: Pick<View, 'game' | 'cfg'>): string {
  const c = v.cfg;
  switch (v.game) {
    case 'klondike':
      return `по ${c.draw === 3 ? 'три' : 'одной'}${c.vegas ? ', Вегас' : ''}${!c.vegas && c.passes ? `, проходов: ${c.passes}` : ''}`;
    case 'spider':
      return c.suits === 1 ? 'одна масть' : c.suits === 2 ? 'две масти' : 'четыре масти';
    case 'freecell':
      return `ячеек: ${c.cells}${c.baker ? ', Бейкер' : ''}`;
    case 'pyramid':
      return c.passes ? `проходов колоды: ${c.passes}` : 'колода без ограничения';
    case 'tripeaks':
    case 'golf':
      return c.wrap ? 'по кругу' : 'без перехода король–туз';
    default:
      return '';
  }
}

const fmt = (ms: number) => {
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

interface Placed extends StageItem {
  p: number;
  i: number;
}

class SolitaireView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private cs: CardStage | null = null;
  private slots!: HTMLElement;
  private banner!: HTMLElement;
  private info!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private seat = 0;
  private live = false;
  /** Ход отправлен — ждём ответа комнаты. */
  private busy = 0;
  private placed = new Map<string, Placed>();
  private geo: Geo | null = null;
  private stageKey = '';
  /** Пирамида: выбранная карта (стопка). */
  private sel: number | null = null;
  private hintOn: { from: number; n: number; to: number | null } | null = null;
  private t0 = Date.now();
  private tEnd = 0;
  private dealId = '';
  private tick = 0;
  /** Идёт каскад победы — остановить. */
  private stopCascade: (() => void) | null = null;
  private drag: { p: number; i: number; n: number; x0: number; y0: number; k: number; els: HTMLElement[]; moved: boolean; id: number } | null = null;
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.send({ t: 'undo' });
    }
  };

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = root;
    preloadDeck(deckStyle());
    const ctl = h(`<div class="so-controls"><div class="so-info"></div><div class="so-btns"></div>
      ${ctx.demo ? '' : '<div class="hint small-hint">Тяните карту или просто нажмите — она пойдёт в лучшее место. Колода — нажатием. Ctrl+Z — отменить ход.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.info = ctl.querySelector('.so-info') as HTMLElement;
    this.btns = ctl.querySelector('.so-btns') as HTMLElement;
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
    this.tick = window.setInterval(() => this.renderInfo(), 1000);
  }

  /** Сцена создаётся, когда известен пасьянс: у каждого свой размер карт. */
  private ensureStage(v: View) {
    const key = v.game + ':' + JSON.stringify(v.cfg);
    if (this.cs && this.stageKey === key) return;
    this.cs?.destroy();
    this.cs?.wrap.remove();
    this.stageKey = key;
    this.cs = new CardStage(this.root, LAND.W, LAND.H, 'so-wrap', '<div class="so-cloth"></div><div class="so-slots"></div>', { portrait: { ...PORT } });
    this.cs.over.innerHTML = '<div class="cs-banner so-banner" hidden></div>';
    this.slots = this.cs.stage.querySelector('.so-slots') as HTMLElement;
    this.banner = this.cs.over.querySelector('.so-banner') as HTMLElement;
    this.cs.onMode = () => this.draw();
    const st = this.cs.stage;
    st.addEventListener('pointerdown', (e) => this.down(e));
    st.addEventListener('pointermove', (e) => this.move(e));
    st.addEventListener('pointerup', (e) => this.up(e));
    st.addEventListener('pointercancel', () => this.cancelDrag());
    st.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private get board(): (Board & { undo: boolean }) | null {
    return this.v?.boards[this.seat] ?? null;
  }

  private c(): Ctx {
    return ctxFor(this.v!, this.v!.deck);
  }

  private chooseSeat(v: View) {
    const mine = this.ctx.demo ? v.seats : this.ctx.mySeats.filter((x) => v.boards[x]);
    this.seat = mine.find((x) => !v.boards[x].end) ?? mine[0] ?? v.seats[0];
  }

  // ---------------------------------------------------------------- раскладка

  private layout(): Placed[] {
    const v = this.v!;
    const b = this.board;
    const out: Placed[] = [];
    if (!b || !this.cs) return out;
    const c = this.c();
    const g = (this.geo = geoOf(v.game, v.cfg, c.kinds, this.cs.portrait));
    const s = g.s;
    const slotHTML: string[] = [];
    b.p.forEach((pile, p) => {
      const pg = g.piles[p];
      const kind = c.kinds[p];
      // пустое место
      if (kind !== 'slot') {
        let lbl = '';
        if (kind === 'found') lbl = v.game === 'well' ? 'К' : ['golf', 'tripeaks', 'pyramid', 'spider', 'scorpion'].includes(v.game) ? '' : 'Т';
        else if (kind === 'stock') lbl = c.g.canStock(c, b) ? '↻' : '✕';
        else if (kind === 'tab') lbl = v.game === 'klondike' || v.game === 'scorpion' ? 'К' : v.game === 'well' && p === 14 ? 'Т' : '';
        slotHTML.push(`<div class="so-slot so-${kind}" data-p="${p}" style="left:${pg.x - (CW * s) / 2}px;top:${pg.y - (CH * s) / 2}px;width:${CW * s}px;height:${CH * s}px"><span>${lbl}</span></div>`);
      }
      // лесенка: закрытые плотнее, открытые — так, чтобы было видно достоинство; длинная — сжимается
      let gapUp = 34 * s;
      const gapDown = 12 * s;
      if (pg.fan === 'down' && pile.length > 1) {
        const downs = pile.filter((id) => !b.up[id]).length;
        const ups = pile.length - 1 - downs;
        const room = g.bottom - pg.y - downs * gapDown;
        if (ups > 0 && ups * gapUp > room) gapUp = Math.max(9 * s, room / ups);
      }
      let y = pg.y;
      const n = pile.length;
      pile.forEach((id, i) => {
        let x = pg.x;
        let yy = pg.y;
        if (pg.fan === 'down') {
          yy = y;
          y += b.up[id] ? gapUp : gapDown;
        } else if (pg.fan === 'w3') {
          const k = i - Math.max(0, n - 3);
          if (k > 0) x += k * 24 * s;
        } else {
          // толщина стопки
          const k = Math.floor(i / 6);
          x -= k * 0.6;
          yy -= k * 0.9;
        }
        out.push({ key: 'k' + id, card: v.deck[id] && b.up[id] ? v.deck[id] : null, x, y: yy, r: 0, s, z: pg.z * 200 + 10 + i, p, i, data: { p: String(p), i: String(i) } });
      });
    });
    this.slots.innerHTML = slotHTML.join('');
    // подсветка: что можно взять, выбранное, подсказка
    if (this.live && !this.ctx.demo) {
      for (const it of out) {
        const kind = c.kinds[it.p];
        const len = b.p[it.p].length;
        if (kind === 'stock' && it.i === len - 1 && v.game !== 'pyramid') it.cls = 'cs-can';
        else if (c.g.canPick(c, b, it.p, len - it.i)) it.cls = 'so-pick';
      }
    }
    if (this.sel != null) for (const it of out) if (it.p === this.sel && it.i === b.p[it.p].length - 1) it.cls = 'cs-sel';
    if (this.hintOn) {
      const hn = this.hintOn;
      for (const it of out) {
        const len = b.p[it.p].length;
        if (it.p === hn.from && it.i >= len - hn.n) it.cls = 'cs-sel';
        if (hn.to != null && it.p === hn.to && it.i === len - 1) it.cls = 'cs-target';
      }
      if (hn.to != null && !b.p[hn.to].length) this.slots.querySelector(`[data-p="${hn.to}"]`)?.classList.add('on');
    }
    return out;
  }

  private draw() {
    if (!this.cs || !this.v) return;
    const items = this.layout();
    this.placed = new Map(items.map((it) => [it.key, it]));
    this.cs.render(items, this.ctx.speed(), null, null, { pair: false });
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.ensureStage(v);
    this.v = v;
    this.chooseSeat(v);
    const id = `${v.game}:${v.seed}:${this.seat}`;
    if (id !== this.dealId) {
      this.dealId = id;
      this.t0 = Date.now();
      this.tEnd = 0;
      this.cs!.clear();
    }
    this.sel = null;
    this.hintOn = null;
    this.banner.hidden = true;
    this.draw();
    this.renderInfo();
    this.renderButtons();
  }

  async play(events: Event[], v: View) {
    this.ensureStage(v);
    this.busy = 0;
    this.v = v;
    this.chooseSeat(v);
    this.sel = null;
    if (events.length) this.hintOn = null; // пустой шаг — ответ на «подсказку», её подсветку не трогаем
    let wait = 0;
    for (const ev of events) {
      if (ev.seat !== this.seat) continue;
      if (ev.type === 'move') {
        if (ev.m.t === 'stock') Sound.shuffle();
        else Sound.card();
        wait = Math.max(wait, 200);
      } else if (ev.type === 'undo') {
        Sound.ui();
        wait = Math.max(wait, 200);
      } else if (ev.type === 'auto') {
        Sound.shuffle();
        wait = Math.max(wait, 500);
      }
    }
    this.draw();
    this.renderInfo();
    this.renderButtons();
    if (wait) await sleep(wait / this.ctx.speed());
    for (const ev of events) {
      if (ev.type === 'won' && ev.seat === this.seat) {
        this.tEnd = Date.now();
        Sound.win();
        this.record(true, ev.moves);
        if (!this.ctx.demo) this.startCascade();
        await this.showBanner(v.seats.length > 1 ? (ev.place === 1 ? 'Сошёлся первым!' : `Сошёлся — ${ev.place}-е место`) : 'Пасьянс сошёлся!', 1600);
      } else if (ev.type === 'won' && v.seats.length > 1) {
        await this.showBanner(`${this.plain(ev.seat)}: сошёлся!`, 1100);
      } else if (ev.type === 'giveup' && ev.seat === this.seat) {
        this.tEnd = Date.now();
        Sound.nomove();
        this.record(false, 0);
      }
    }
  }

  setTurn(toAct: number[], interactive: number[]) {
    const was = this.live;
    this.live = !this.ctx.demo && interactive.includes(this.seat) && !!this.board && !this.board.end;
    if (was !== this.live) this.draw();
    this.renderButtons();
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  /** Карты с баз слетают по очереди — по верхней с каждой базы, по кругу. */
  private startCascade() {
    const v = this.v;
    const b = this.board;
    if (!v || !b || !this.cs) return;
    const kinds = this.c().kinds;
    const piles = b.p.map((pile, p) => (kinds[p] === 'found' ? [...this.placed.values()].filter((it) => it.p === p && it.card).sort((a, c) => c.i - a.i) : [])).filter((x) => x.length);
    const order: Launch[] = [];
    const stage = this.cs.stage;
    for (let r = 0; piles.some((x) => r < x.length); r++)
      for (const pile of piles) {
        const it = pile[r];
        if (!it) continue;
        order.push({
          card: it.card!,
          x: it.x,
          y: it.y,
          w: CW * it.s,
          h: CH * it.s,
          hide: () => {
            const el = stage.querySelector(`[data-p="${it.p}"][data-i="${it.i}"]`) as HTMLElement | null;
            if (el) el.style.visibility = 'hidden';
          },
        });
      }
    this.stopCascade?.();
    this.stopCascade = cascade(this.cs.over, this.cs.W, this.cs.H, order, () => {
      this.stopCascade = null;
      stage.querySelectorAll<HTMLElement>('[data-p][data-i]').forEach((el) => (el.style.visibility = ''));
      this.draw();
    });
  }

  private async showBanner(text: string, ms: number) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    await sleep(ms);
    this.banner.hidden = true;
  }

  // ---------------------------------------------------------------- панель

  private renderInfo() {
    const v = this.v;
    const b = this.board;
    if (!v || !b) return;
    const c = this.c();
    const lvl = LEVELS.find((l) => l.id === v.level);
    const t = (this.tEnd || Date.now()) - this.t0;
    const prog = c.g.progress(c, b);
    const total = c.g.total(c);
    const what = v.game === 'pyramid' || v.game === 'tripeaks' || v.game === 'golf' ? 'Убрано' : 'В доме';
    const score = v.game === 'klondike' || v.game === 'spider' || v.game === 'tripeaks' ? ` · счёт <b>${b.score}</b>` : '';
    const vt = variantText(v);
    const conv = convergence(v.game, v.cfg);
    this.info.innerHTML = `<div><b>${GAME_LABEL[v.game]}</b>${vt ? ` <small>· ${esc(vt)}</small>` : ''}</div>
      <div><small>Раздача: ${lvl ? lvl.label.toLowerCase() : ''}${hasLevel(v.game, v.cfg, v.level) ? '' : ' — отобранных нет, выпала случайная'} · № ${v.seed}</small></div>
      ${v.level === 'any' && conv ? `<div><small>Сходится: ${esc(conv)}</small></div>` : ''}
      <div>⏱ <b>${fmt(t)}</b> · ходов <b>${b.moves}</b>${score}</div>
      <div>${what}: <b>${prog}</b> из ${total}<div class="so-bar"><i style="width:${Math.round((prog / total) * 100)}%"></i></div></div>`;
  }

  private renderButtons() {
    const b = this.board;
    if (!b || this.ctx.demo) {
      this.btns.innerHTML = '';
      return;
    }
    const c = this.c();
    const on = this.live;
    const canAuto = on && !!c.g.autoOk?.(c, b) && c.kinds.some((k, i) => k !== 'found' && b.p[i].length > 0);
    this.btns.innerHTML = `<button class="btn small" data-a="undo" ${on && b.undo ? '' : 'disabled'}>↶ Отменить</button>
      <button class="btn small" data-a="hint" ${on ? '' : 'disabled'}>💡 Подсказка</button>
      ${canAuto ? '<button class="btn primary small" data-a="auto">Собрать</button>' : ''}
      <button class="btn small" data-a="giveup" ${on ? '' : 'disabled'}>Сдаться</button>`;
    this.btns.querySelectorAll<HTMLButtonElement>('button').forEach((x) => {
      x.onclick = () => {
        Sound.unlock();
        const a = x.dataset.a!;
        if (a === 'hint') this.showHint();
        else if (a === 'giveup') {
          if (confirm('Сдаться? Раздача будет засчитана как несошедшаяся.')) this.send({ t: 'giveup' });
        } else this.send({ t: a as 'undo' | 'auto' });
      };
    });
  }

  private showHint() {
    const b = this.board;
    if (!b) return;
    const m = hint(this.c(), b);
    if (!m) {
      Sound.nomove();
      void this.showBanner('Ходов нет — отмените ход или сдайтесь', 1400);
      return;
    }
    this.send({ t: 'hint' }); // партия уходит в таблицу рекордов «с подсказками»
    if (m.t === 'stock') this.hintOn = { from: this.c().kinds.indexOf('stock'), n: 1, to: null };
    else this.hintOn = { from: m.f, n: m.n, to: m.to };
    this.draw();
    setTimeout(() => {
      this.hintOn = null;
      this.draw();
    }, 1600);
  }

  private record(won: boolean, moves: number) {
    const v = this.v;
    if (!v || this.ctx.demo) return;
    const key = seedKey(v.game, v.cfg);
    const all = store.get<Record<string, Record_>>(RECORDS, {});
    const vt = variantText(v);
    const r = all[key] ?? { title: GAME_LABEL[v.game] + (vt ? ` (${vt})` : ''), played: 0, won: 0, best: 0, bestMoves: 0 };
    r.played++;
    if (won) {
      r.won++;
      const t = Math.round((this.tEnd - this.t0) / 1000);
      if (!r.best || t < r.best) r.best = t;
      if (!r.bestMoves || moves < r.bestMoves) r.bestMoves = moves;
    }
    all[key] = r;
    store.set(RECORDS, all);
  }

  // ---------------------------------------------------------------- ходы

  private send(a: Action) {
    if (!this.live || (this.busy && Date.now() - this.busy < 1500)) return;
    this.busy = Date.now();
    this.ctx.act(this.seat, a);
  }

  private hit(e: PointerEvent): { p: number; i: number } | null {
    const el = (e.target as HTMLElement).closest('.cs-card, .so-slot') as HTMLElement | null;
    if (!el || el.dataset.p == null) return null;
    return { p: Number(el.dataset.p), i: el.dataset.i == null ? -1 : Number(el.dataset.i) };
  }

  private down(e: PointerEvent) {
    if (!this.live || !this.v || e.button > 0) return;
    Sound.unlock();
    const at = this.hit(e);
    const b = this.board!;
    if (!at) {
      if (this.sel != null) {
        this.sel = null;
        this.draw();
      }
      return;
    }
    const c = this.c();
    const kind = c.kinds[at.p];
    // колода (и пустое место колоды — перевернуть заново)
    if (kind === 'stock' && !(this.v.game === 'pyramid' && at.i >= 0 && at.i === b.p[at.p].length - 1)) {
      if (c.g.canStock(c, b)) this.send({ t: 'stock' });
      else Sound.nomove();
      return;
    }
    if (at.i < 0) return;
    const n = b.p[at.p].length - at.i;
    if (!c.g.canPick(c, b, at.p, n)) return;
    const k = this.cs!.stage.getBoundingClientRect().width / this.cs!.W;
    const els: HTMLElement[] = [];
    for (let i = at.i; i < b.p[at.p].length; i++) {
      const el = this.cs!.stage.querySelector(`.cs-card[data-p="${at.p}"][data-i="${i}"]`) as HTMLElement | null;
      if (el) els.push(el);
    }
    this.drag = { p: at.p, i: at.i, n, x0: e.clientX, y0: e.clientY, k, els, moved: false, id: e.pointerId };
    this.cs!.stage.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = (e.clientX - d.x0) / d.k;
    const dy = (e.clientY - d.y0) / d.k;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    d.els.forEach((el, j) => {
      el.style.translate = `${dx}px ${dy}px`;
      el.style.zIndex = String(5000 + j);
      el.classList.add('so-drag');
    });
  }

  /** Оставить карты там, где их отпустили (без прыжка назад), — дальше их увезёт обычная раскладка. */
  private settle(d: NonNullable<SolitaireView['drag']>, dx: number, dy: number) {
    for (const el of d.els) {
      const key = [...this.placed.values()].find((it) => it.p === Number(el.dataset.p) && it.i === Number(el.dataset.i));
      el.classList.remove('so-drag');
      el.style.translate = '';
      if (!key) continue;
      el.style.transition = 'none';
      el.style.transform = `translate(${key.x + dx - CW / 2}px, ${key.y + dy - CH / 2}px) scale(${key.s})`;
      void el.offsetWidth;
      el.style.transition = '';
    }
  }

  private cancelDrag() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    this.settle(d, 0, 0);
    this.draw();
  }

  private up(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    const b = this.board!;
    const c = this.c();
    const dx = (e.clientX - d.x0) / d.k;
    const dy = (e.clientY - d.y0) / d.k;
    if (!d.moved) return this.tap(d.p, d.n);
    // куда бросили: ближайшая стопка, куда можно, — по месту ведущей карты
    const lead = [...this.placed.values()].find((it) => it.p === d.p && it.i === d.i);
    let best: number | null = null;
    if (lead && this.geo) {
      const cx = lead.x + dx;
      const cy = lead.y + dy;
      const s = this.geo.s;
      let bd = Infinity;
      for (let j = 0; j < b.p.length; j++) {
        if (j === d.p || !c.g.canDrop(c, b, d.p, d.n, j)) continue;
        const pg = this.geo.piles[j];
        const last = [...this.placed.values()].filter((it) => it.p === j).pop();
        const tx = last?.x ?? pg.x;
        const ty = last?.y ?? pg.y;
        if (Math.abs(cx - tx) > CW * s * 0.9 || cy < Math.min(pg.y, ty) - CH * s * 0.9 || cy > ty + CH * s * 0.9) continue;
        const dist = Math.hypot(cx - tx, cy - ty);
        if (dist < bd) {
          bd = dist;
          best = j;
        }
      }
    }
    this.settle(d, dx, dy);
    if (best == null) {
      this.draw();
      return;
    }
    this.sel = null;
    this.send({ t: 'mv', f: d.p, n: d.n, to: best });
  }

  /** Нажатие на карту: пирамида — выбор пары; остальное — лучшее место. */
  private tap(p: number, n: number) {
    const b = this.board!;
    const c = this.c();
    if (this.v!.game === 'pyramid') {
      const f = c.kinds.indexOf('found');
      if (c.g.canDrop(c, b, p, 1, f)) return this.go({ t: 'mv', f: p, n: 1, to: f });
      if (this.sel != null && this.sel !== p && c.g.canDrop(c, b, this.sel, 1, p)) {
        const from = this.sel;
        this.sel = null;
        return this.go({ t: 'mv', f: from, n: 1, to: p });
      }
      // верхняя карта колоды лежит лицом: нажатие без пары — просто открыть следующую
      if (c.kinds[p] === 'stock') {
        this.sel = null;
        return this.go({ t: 'stock' });
      }
      this.sel = this.sel === p ? null : p;
      this.draw();
      return;
    }
    // нажали на середину лесенки, которую взять нельзя целиком, — пробуем верхнюю карту
    let to = bestTarget(c, b, p, n);
    if (to == null && n > 1 && upRun(b, p) >= 1) {
      to = bestTarget(c, b, p, 1);
      if (to != null) n = 1;
    }
    if (to == null) {
      Sound.nomove();
      this.draw();
      return;
    }
    this.go({ t: 'mv', f: p, n, to });
  }

  private go(m: Move) {
    this.send(m);
  }

  status(v: View, toAct: number[], interactive: number[]) {
    const b = v.boards[this.seat];
    if (!b) return v.seats.length > 1 ? 'Дуэль: каждый раскладывает свою копию раздачи' : '';
    if (b.end === 1) return 'Пасьянс сошёлся!';
    if (b.end === 2) return 'Пасьянс не сошёлся';
    if (!interactive.includes(this.seat)) return `${GAME_LABEL[v.game]}…`;
    const c = ctxFor(v, v.deck);
    const others = v.seats.filter((x) => x !== this.seat && !v.sum[x].end).length;
    const duel = v.seats.length > 1 ? ` · соперников в игре: ${others}` : '';
    return `${c.g.won(c, b) ? '' : 'Ваш пасьянс'}${duel}`;
  }

  playerStats(v: View, seat: number) {
    const s = v.sum[seat];
    if (!s) return '';
    const mark = s.end === 1 ? ' ✓' : s.end === 2 ? ' ✕' : '';
    return `<span title="Убрано карт">🂠 ${s.prog}/${s.total}${mark}</span><span title="Ходов">↻ ${s.moves}</span>`;
  }

  destroy() {
    this.stopCascade?.();
    this.cs?.destroy();
    clearInterval(this.tick);
    document.removeEventListener('keydown', this.onKey);
  }
}

export function createView(): GameView<View, Event> {
  return new SolitaireView();
}

export { SUIT_SYM };
