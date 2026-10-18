/* Маджонг вчетвером — отрисовка: квадратный стол с сукном, вид сверху. Каждый игрок раскладывается «как снизу» и поворачивается
 * на своё место: следующий по ходу — справа, напротив — сверху. Своя рука крупно; чужие — рубашкой. Сбросы — перед каждым по шесть в ряд.
 * Свой ход: нажали кость — приподнялась, нажали ещё раз — сброс. Заявки на чужой сброс и прочее — кнопками в панели. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { tileDefs, tileSvg } from '../mahjong/draw';
import { kindName, kindOf, kindShort, rankOf, suitOf, WIND_NAMES, WIND_SHORT } from '../mahjong/tiles';
import { choose } from './ai';
import { doraOf, isRed, type Action, type Event, type WinRec } from './engine';
import { STYLE_LABEL, styleKey } from './def';
import { handWaits, visibleCounts, type View } from './view-model';
import type { Meld } from './score';
import '../mahjong/mahjong.css';
import './mahjong4.css';

const N = 1000;
const C = N / 2;
// своя рука
const HW = 56;
const HH = 76;
// сбросы и чужие кости
const SW = 36;
const SH = 48;
const P = 'm4';

const SUITS = ['медяки', 'бамбуки', 'тьмы'];

class Mahjong4View implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gBoard!: SVGGElement;
  private gBanner!: SVGGElement;
  private over!: HTMLElement;
  private cover!: HTMLElement;
  private btns!: HTMLElement;
  private info!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private hidden = false;
  private sel: number | null = null;
  private riichiMode = false;
  private live: number[] = [];
  private busy = 0;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="m4-wrap">
      <svg class="m4-board" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}">
        <defs>${tileDefs(P)}
          <radialGradient id="m4Felt" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#2f7350"/><stop offset=".7" stop-color="#1f5238"/><stop offset="1" stop-color="#143a27"/></radialGradient>
          <linearGradient id="m4Wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a4a22"/><stop offset=".5" stop-color="#5a3216"/><stop offset="1" stop-color="#3e220e"/></linearGradient>
        </defs>
        <rect x="0" y="0" width="${N}" height="${N}" rx="34" fill="url(#m4Wood)"/>
        <rect x="16" y="16" width="${N - 32}" height="${N - 32}" rx="22" fill="url(#m4Felt)"/>
        <g class="m4-g"></g><g class="m4-banner"></g>
      </svg>
      <div class="m4-over" hidden></div>
      <div class="m4-cover" hidden><div class="m4-cover-box"><div class="m4-cover-t"></div><button class="btn primary">Показать кости</button></div></div>
    </div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.gBoard = this.svg.querySelector('.m4-g') as SVGGElement;
    this.gBanner = this.svg.querySelector('.m4-banner') as SVGGElement;
    this.over = wrap.querySelector('.m4-over') as HTMLElement;
    this.cover = wrap.querySelector('.m4-cover') as HTMLElement;
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
    };
    this.svg.addEventListener('click', (e) => this.onClick(e));
    const ctl = h(`<div class="m4-controls"><div class="m4-info"></div><div class="m4-btns"></div>
      ${ctx.demo ? '' : '<div class="hint small-hint">Свой ход: нажмите кость — она приподнимется, нажмите ещё раз — сброс. Заявки на чужой сброс — кнопками.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.m4-btns') as HTMLElement;
    this.info = ctl.querySelector('.m4-info') as HTMLElement;
  }

  // ---------------------------------------------------------------- места

  private spot(seat: number) {
    return (seat - this.viewer + 4) % 4;
  }

  private mine() {
    return this.ctx.mySeats.filter((x) => x >= 0 && x < 4);
  }

  private chooseViewer(v: View, toAct: number[]) {
    const mine = this.mine();
    if (!mine.length) {
      this.viewer = 0;
      return;
    }
    if (mine.length === 1) {
      this.viewer = mine[0];
      return;
    }
    // несколько игроков за одним экраном: чей ход — того и рука, перед этим занавеска
    const next = toAct.find((x) => mine.includes(x) && (v.phase !== 'end'));
    if (next != null && next !== this.viewer) {
      this.viewer = next;
      this.hidden = true;
    } else if (!mine.includes(this.viewer)) this.viewer = mine[0];
  }

  private faceUp(seat: number) {
    const v = this.v!;
    if (this.ctx.demo) return true;
    if (v.p[seat].hand == null) return false;
    if (seat === this.viewer) return !this.hidden;
    return !this.mine().includes(seat) || v.p[seat].won || v.phase === 'end' || v.phase === 'over';
  }

  // ---------------------------------------------------------------- отрисовка

  private tile(id: number, x: number, y: number, w: number, hh: number, o: { cls?: string; attrs?: string; back?: boolean; d?: number } = {}) {
    return tileSvg(id < 0 ? -1 : kindOf(id), x, y, w, hh, { p: P, d: o.d ?? Math.round(w * 0.14), cls: o.cls, attrs: o.attrs, back: o.back || id < 0, red: id >= 0 && !!this.v && isRed(this.v.cfg, id) });
  }

  /** Лежащая боком кость (риичи, взятая у соседа): поворот вокруг центра. */
  private sideTile(id: number, x: number, y: number, w: number, hh: number, cls = '') {
    // повёрнутая кость занимает hh×w; (x, y) — левый верх занятого места
    return `<g transform="translate(${x + hh / 2},${y + hh - w / 2}) rotate(-90) translate(${-w / 2},${-hh / 2})">${this.tile(id, 0, 0, w, hh, { cls })}</g>`;
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    let s = '';
    s += this.centerSvg(v);
    for (let seat = 0; seat < 4; seat++) {
      const sp = this.spot(seat);
      const rot = [0, -90, 180, 90][sp];
      s += `<g transform="rotate(${rot} ${C} ${C})">${this.seatSvg(v, seat, sp === 0)}</g>`;
    }
    this.gBoard.innerHTML = s;
  }

  private centerSvg(v: View): string {
    const x0 = C - 122;
    const y0 = C - 122;
    let s = `<rect class="m4-center" x="${x0}" y="${y0}" width="244" height="244" rx="18"/>`;
    const roundName = `${WIND_NAMES[v.round % 4]} ${((v.dealer - 0 + 4) % 4) + 1}`;
    s += `<text class="m4-round" x="${C}" y="${C - 52}">${roundName}</text>`;
    const extras = [v.honba ? `повтор ${v.honba}` : '', v.sticks ? `ставки ${v.sticks}×1000` : ''].filter(Boolean).join(' · ');
    s += `<text class="m4-small" x="${C}" y="${C - 24}">${extras || STYLE_LABEL[styleKey(v.cfg)]}</text>`;
    s += `<text class="m4-wall" x="${C}" y="${C + 8}">в стене ${v.wall}</text>`;
    if (v.dora.length) {
      const w = 30;
      const hh = 40;
      const x = C - (v.dora.length * (w + 4)) / 2;
      s += `<text class="m4-small" x="${C}" y="${C + 36}">дора</text>`;
      v.dora.forEach((id, i) => (s += this.tile(id, x + i * (w + 4), C + 44, w, hh, { d: 3 })));
    }
    // стена: остаток — стопками по две вокруг центра (у каждой стороны до 17 стопок)
    const dead = v.cfg.style === 'riichi' ? 14 : 0;
    let stacks = Math.ceil((v.wall + dead) / 2);
    const SW2 = 13;
    for (let side = 0; side < 4; side++) {
      const n = Math.min(17, stacks);
      stacks -= n;
      let w = '';
      const x1 = C - (17 * SW2) / 2;
      for (let i = 0; i < n; i++) w += `<rect x="${x1 + i * SW2 + 1}" y="${y0 + 253}" width="${SW2 - 1}" height="16" rx="2" fill="url(#${P}Bone)"/><rect class="m4-wall-t" x="${x1 + i * SW2}" y="${y0 + 250}" width="${SW2 - 1}" height="15" rx="2"/>`;
      s += `<g transform="rotate(${-90 * side} ${C} ${C})">${w}</g>`;
    }
    // ветра и очки по сторонам
    for (let seat = 0; seat < 4; seat++) {
      const sp = this.spot(seat);
      const rot = [0, -90, 180, 90][sp];
      const p = v.p[seat];
      const turn = (v.phase === 'turn' && v.turn === seat) || v.waiting.includes(seat);
      s += `<g transform="rotate(${rot} ${C} ${C})">
        <text class="m4-seat ${turn ? 'm4-turn' : ''}" x="${C}" y="${y0 + 234}"><tspan class="m4-wind ${seat === v.dealer ? 'm4-dealer' : ''}">${WIND_SHORT[p.wind]}</tspan> ${esc(this.plain(seat))} · ${v.scores[seat]}</text>
        ${p.riichi ? `<rect class="m4-stick" x="${C - 40}" y="${y0 + 211}" width="80" height="6" rx="3"/><circle cx="${C}" cy="${y0 + 214}" r="2.2" fill="#c0281e"/>` : ''}
      </g>`;
    }
    return s;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  /** Раскладка места «как снизу»: сбросы перед центром, рука у края, сеты справа, цветы слева. */
  private seatSvg(v: View, seat: number, me: boolean): string {
    const p = v.p[seat];
    let s = '';
    // сбросы: по шесть в ряд
    const lastId = v.last && v.last.seat === seat && v.phase === 'claim' ? v.last.id : -1;
    let x = C - 3 * SW;
    let y = C + 156;
    let col = 0;
    p.discards.forEach((d, i) => {
      if (col === 6 && y < C + 156 + 2 * (SH + 6)) {
        col = 0;
        x = C - 3 * SW;
        y += SH + 6;
      }
      const cls = `${d.taken ? 'm4-taken' : ''} ${d.id === lastId && i === p.discards.length - 1 ? 'm4-last' : ''}`;
      if (d.riichi) {
        s += this.sideTile(d.id, x, y, SW, SH, cls);
        x += SH;
      } else {
        s += this.tile(d.id, x, y, SW, SH, { cls, d: 4 });
        x += SW;
      }
      col++;
    });
    const up = this.faceUp(seat);
    if (me) {
      s += this.ownHand(v, seat, up);
    } else {
      // чужая рука — стоящие кости, видны рубашки (или лица — после выигрыша)
      const n = p.count;
      const hx = C - 260;
      const hy = N - 16 - SH - 26;
      const hand = up && p.hand ? sortIds(p.hand) : new Array(n).fill(-1);
      hand.forEach((id, i) => (s += this.tile(id, hx + i * SW, hy, SW, SH, { d: 5, back: !up })));
      s += this.meldsSvg(p.melds, seat, N - 32, hy, SW, SH);
      s += this.flowersSvg(p.flowers, hx - 8, hy, 24, 32);
    }
    if (v.cfg.sichuan && p.missing >= 0) s += `<text class="m4-missing" x="${C + 150}" y="${C + 140}">нет: ${SUITS[p.missing]}</text>`;
    if (p.won) s += `<text class="m4-wonmark" x="${C}" y="${C + 300}">маджонг!</text>`;
    return s;
  }

  /** Сеты справа налево от правого края x1. */
  private meldsSvg(melds: Meld[], seat: number, x1: number, y: number, w: number, hh: number): string {
    let s = '';
    let x = x1;
    for (const m of [...melds].reverse()) {
      const ids = m.ids;
      // взятая кость лежит боком: у соседа слева — слева, напротив — посередине, справа — справа
      const rel = m.from != null ? (m.from - seat + 4) % 4 : 0;
      const sideAt = m.open && m.called != null ? (rel === 3 ? 0 : rel === 2 ? 1 : ids.length - 1) : -1;
      const others = ids.filter((id) => id !== m.called);
      const order: number[] = [];
      let oi = 0;
      for (let i = 0; i < ids.length; i++) order.push(i === sideAt ? m.called! : others[oi++]);
      const width = order.reduce((a, _id, i) => a + (i === sideAt ? hh : w), 0);
      x -= width;
      let cx = x;
      order.forEach((id, i) => {
        if (i === sideAt) {
          s += this.sideTile(id, cx, y + (hh - w), w, hh);
          cx += hh;
        } else {
          // закрытый конг: крайние рубашкой
          const back = !m.open && (i === 0 || i === 3);
          s += this.tile(id, cx, y, w, hh, { back, d: 4 });
          cx += w;
        }
      });
      x -= 8;
    }
    return s;
  }

  private flowersSvg(fl: number[], x1: number, y: number, w: number, hh: number): string {
    let s = '';
    fl.forEach((id, i) => (s += this.tile(id, x1 - (i + 1) * (w + 2), y + 6, w, hh, { d: 3 })));
    return s;
  }

  private ownHand(v: View, seat: number, up: boolean): string {
    const p = v.p[seat];
    const t = v.turnOpts[seat];
    const canAct = this.live.includes(seat) && !!t && !this.hidden;
    const hand = p.hand ?? new Array(p.count).fill(-1);
    // взятая кость — отдельно справа
    const drawn = v.drawn >= 0 && hand.includes(v.drawn) && v.turn === seat ? v.drawn : -1;
    const rest = sortIds(hand.filter((id) => id !== drawn));
    const n = rest.length + (drawn >= 0 ? 1 : 0);
    const meldW = p.melds.reduce((a, m) => a + m.ids.length * 40 + 30, 0);
    const total = n * HW + (drawn >= 0 ? 16 : 0);
    let x = Math.max(24, Math.min(C - total / 2, N - 24 - total - (meldW > 0 ? 0 : 0)));
    const y = N - 16 - HH - 22;
    let s = '';
    const allowed = new Set(this.riichiMode ? t?.riichi ?? [] : t?.ok ?? []);
    const one = (id: number) => {
      const can = canAct && allowed.has(id);
      const lift = this.sel === id ? -16 : 0;
      const cls = `m4-own ${can ? 'm4-can' : canAct ? 'm4-no' : ''} ${this.sel === id ? 'm4-sel' : ''} ${this.riichiMode && can ? 'm4-riichi' : ''}`;
      s += this.tile(up ? id : -1, x, y + lift, HW, HH, { cls, attrs: `data-id="${id}"`, back: !up, d: 9 });
      x += HW;
    };
    rest.forEach(one);
    if (drawn >= 0) {
      x += 16;
      one(drawn);
    }
    // сеты — над рукой справа, цветы — над рукой слева
    s += this.meldsSvg(p.melds, seat, N - 30, y - 64, 40, 54);
    s += this.flowersSvg(p.flowers, 30 + p.flowers.length * 28, y - 52, 26, 35);
    return s;
  }

  // ---------------------------------------------------------------- панель

  private renderButtons() {
    const v = this.v;
    this.btns.innerHTML = '';
    if (!v || this.ctx.demo) return;
    const seat = this.viewer;
    const can = this.live.includes(seat) && !this.hidden;
    const btn = (label: string, cls: string, fn: () => void, off = false) => {
      const e = h(`<button class="btn ${cls}">${label}</button>`) as HTMLButtonElement;
      e.disabled = off;
      e.onclick = () => {
        Sound.unlock();
        fn();
      };
      this.btns.appendChild(e);
      return e;
    };
    if (v.phase === 'missing' && can) {
      this.btns.appendChild(h('<div class="m4-ask">От какой масти отказаться? Пока её кости на руке — сбрасывать только их.</div>'));
      SUITS.forEach((name, i) => btn(name[0].toUpperCase() + name.slice(1), i === suggestMissing(v, seat) ? 'primary' : '', () => this.send({ t: 'missing', suit: i })));
      return;
    }
    if (v.phase === 'claim' && can && v.claims[seat]) {
      const o = v.claims[seat];
      const id = v.last!.id;
      this.btns.appendChild(h(`<div class="m4-ask">${v.rob ? 'Добавляют к конгу' : 'Сброс'}: <b>${esc(kindName(kindOf(id)))}</b></div>`));
      if (o.ron) btn(v.rob ? 'Рон — ограбить конг!' : 'Рон — маджонг!', 'primary m4-ron', () => this.send({ t: 'ron' }));
      if (o.pon) btn('Пон', '', () => this.send({ t: 'pon' }));
      if (o.mkan) btn('Конг', '', () => this.send({ t: 'mkan' }));
      for (const k of o.chi ?? []) btn(`Чи ${rankOf(k)}-${rankOf(k) + 1}-${rankOf(k) + 2} ${['медяков', 'бамбуков', 'тем'][suitOf(k)]}`, '', () => this.send({ t: 'chi', k }));
      btn('Пропустить', 'ghost', () => this.send({ t: 'pass' }));
      return;
    }
    if (v.phase === 'turn' && can && v.turnOpts[seat]) {
      const t = v.turnOpts[seat];
      if (t.tsumo) btn('Цумо — маджонг!', 'primary m4-ron', () => this.send({ t: 'tsumo' }));
      for (const k of t.kans) btn(`Конг: ${esc(kindName(k))}`, '', () => this.send({ t: 'kan', k }));
      if (t.riichi.length)
        btn(this.riichiMode ? 'Риичи: выберите сброс (отмена)' : 'Риичи', this.riichiMode ? 'primary' : '', () => {
          this.riichiMode = !this.riichiMode;
          this.sel = null;
          this.draw();
          this.renderButtons();
        });
      if (this.sel != null) btn(`Сбросить ${esc(kindName(kindOf(this.sel)))}`, 'primary', () => this.discardSel());
      return;
    }
    if (v.phase === 'end' && this.mine().some((x) => !v.acks[x])) btn('Дальше', 'primary', () => this.sendNext());
  }

  private renderInfo() {
    const v = this.v;
    if (!v) return;
    const seat = this.viewer;
    let hint = '';
    if (v.cfg.hints && this.mine().includes(seat) && !this.hidden && v.p[seat].hand) {
      const hand = v.p[seat].hand!;
      if (v.phase === 'turn' && v.turn === seat && v.turnOpts[seat] && hand.length % 3 === 2) {
        const a = choose(v, seat, 1, { next: () => 0.5, int: () => 0, getState: () => 0 });
        if (a && a.t === 'discard') hint = `Совет: сбросить <b>${esc(kindName(kindOf(a.id)))}</b>${a.riichi ? ' и объявить риичи' : ''}`;
        else if (a && a.t === 'tsumo') hint = 'Рука собрана — объявляйте маджонг!';
      } else if (hand.length % 3 === 1) {
        const w = handWaits(v, seat, hand);
        if (w.length) {
          const seen = visibleCounts(v, seat);
          hint = `Ждёте: ${w.map((k) => `<b>${kindShort(k)}</b> <small>(ещё ${Math.max(0, 4 - seen[k])})</small>`).join(', ')}`;
        }
      }
    }
    this.info.innerHTML = `<div class="m4-rules">${esc(STYLE_LABEL[styleKey(v.cfg)])}</div>${hint ? `<div class="m4-hint">${hint}</div>` : ''}`;
  }

  // ---------------------------------------------------------------- действия

  private send(a: Action) {
    if (this.busy && Date.now() - this.busy < 1500) return;
    this.busy = Date.now();
    this.sel = null;
    this.riichiMode = false;
    this.ctx.act(this.viewer, a);
  }

  private sendNext() {
    const v = this.v!;
    for (const x of this.mine()) if (!v.acks[x]) this.ctx.act(x, { t: 'next' });
  }

  private discardSel() {
    if (this.sel == null) return;
    this.send({ t: 'discard', id: this.sel, riichi: this.riichiMode || undefined });
  }

  private onClick(e: MouseEvent) {
    const v = this.v;
    if (!v || this.ctx.demo) return;
    const el = (e.target as Element).closest('[data-id]');
    const seat = this.viewer;
    const t = v.turnOpts[seat];
    if (!el || !t || !this.live.includes(seat) || this.hidden) return;
    const id = Number(el.getAttribute('data-id'));
    const allowed = this.riichiMode ? t.riichi : t.ok;
    if (!allowed.includes(id)) {
      el.classList.add('mj-shake');
      window.setTimeout(() => el.classList.remove('mj-shake'), 350);
      return;
    }
    if (this.sel === id) {
      this.discardSel();
      return;
    }
    this.sel = id;
    Sound.ui();
    this.draw();
    this.renderButtons();
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.v = v;
    if (this.sel != null && !(v.p[this.viewer].hand ?? []).includes(this.sel)) this.sel = null;
    if (v.phase !== 'turn') this.riichiMode = false;
    this.busy = 0;
    this.draw();
    this.renderButtons();
    this.renderInfo();
    this.showResult();
  }

  private banner(text: string, seat: number) {
    const sp = this.spot(seat);
    const pos = [
      [C, C + 230],
      [C + 230, C],
      [C, C - 230],
      [C - 230, C],
    ][sp];
    this.gBanner.innerHTML = `<g class="m4-call" transform="translate(${pos[0]},${pos[1]})"><rect x="-90" y="-34" width="180" height="68" rx="16"/><text>${esc(text)}</text></g>`;
  }

  async play(events: Event[], v: View) {
    const speed = Math.max(0.3, this.ctx.speed?.() ?? 1);
    for (const ev of events) {
      if (ev.type === 'discard') {
        Sound.place();
        if (ev.riichi) {
          this.banner('Риичи!', ev.seat);
          await sleep(700 / speed);
          this.gBanner.innerHTML = '';
        }
      } else if (ev.type === 'call') {
        this.banner(ev.t === 'chi' ? 'Чи!' : ev.t === 'pon' ? 'Пон!' : 'Конг!', ev.seat);
        Sound.capture();
        await sleep(650 / speed);
        this.gBanner.innerHTML = '';
      } else if (ev.type === 'kan') {
        this.banner('Конг!', ev.seat);
        Sound.capture();
        await sleep(650 / speed);
        this.gBanner.innerHTML = '';
      } else if (ev.type === 'win') {
        this.banner(ev.rec.from < 0 ? 'Цумо!' : 'Рон!', ev.rec.seat);
        Sound.win();
        await sleep(1000 / speed);
        this.gBanner.innerHTML = '';
      } else if (ev.type === 'deal') {
        Sound.shuffle();
      } else if (ev.type === 'flower') {
        Sound.step();
      }
    }
    this.setView(v);
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.live = interactive;
    if (this.v) this.chooseViewer(this.v, toAct);
    if (this.hidden && this.mine().length > 1) {
      this.cover.hidden = false;
      (this.cover.querySelector('.m4-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}. Остальные — не подглядывать!`;
    }
    this.draw();
    this.renderButtons();
    this.renderInfo();
  }

  // ---------------------------------------------------------------- итог раздачи

  private resultKey = '';

  private showResult() {
    const v = this.v!;
    const r = v.result;
    if ((v.phase !== 'end' && v.phase !== 'over') || !r) {
      this.over.hidden = true;
      this.resultKey = '';
      return;
    }
    const key = JSON.stringify(r.deltas) + v.phase + r.wins.length + v.acks.join();
    if (key === this.resultKey) return;
    this.resultKey = key;
    const wins = r.wins.map((w) => this.winHtml(v, w)).join('');
    const draw = r.kind === 'draw' ? `<div class="m4-res-t">Ничья — стена кончилась</div>${r.tenpai ? `<div>Готовы: ${r.tenpai.map((t, i) => (t ? this.ctx.name(i) : '')).filter(Boolean).join(', ') || 'никто'}</div>` : ''}` : '';
    const deltas = `<table class="m4-deltas">${[0, 1, 2, 3].map((i) => `<tr><td>${this.ctx.name(i)}</td><td class="${r.deltas[i] > 0 ? 'pos' : r.deltas[i] < 0 ? 'neg' : ''}">${r.deltas[i] > 0 ? '+' : ''}${r.deltas[i]}</td><td>${v.scores[i]}</td></tr>`).join('')}</table>`;
    const waiting = v.phase === 'end' ? [0, 1, 2, 3].filter((x) => !v.acks[x]) : [];
    const mineWait = this.mine().some((x) => !v.acks[x]);
    this.over.innerHTML = `<div class="m4-res">${draw}${wins}${deltas}
      ${v.phase === 'over' ? '<div class="m4-res-t">Партия окончена</div>' : mineWait && !this.ctx.demo ? '<button class="btn primary m4-next">Дальше</button>' : waiting.length ? `<div class="m4-wait">Ждём: ${waiting.map((x) => this.ctx.name(x)).join(', ')}</div>` : ''}</div>`;
    this.over.hidden = false;
    const b = this.over.querySelector('.m4-next') as HTMLButtonElement | null;
    if (b) b.onclick = () => this.sendNext();
  }

  private winHtml(v: View, w: WinRec): string {
    const tilesSvg = (ids: number[], extra: Meld[]) => {
      const tw = 34;
      const th = 46;
      const all = [...sortIds(ids.filter((id) => id !== w.win)), w.win];
      const meldIds = extra.flatMap((m) => m.ids);
      const width = (all.length + meldIds.length) * tw + 14 + extra.length * 8 + 10;
      let s = `<svg class="m4-res-hand" viewBox="0 0 ${width} ${th + 10}" width="${width}"><defs>${tileDefs('rs')}</defs>`;
      let x = 2;
      all.forEach((id, i) => {
        if (i === all.length - 1) x += 10;
        s += tileSvg(kindOf(id), x, 2, tw, th, { p: 'rs', d: 4, red: isRed(v.cfg, id), cls: i === all.length - 1 ? 'm4-wintile' : '' });
        x += tw;
      });
      x += 8;
      for (const m of extra) {
        for (const id of m.ids) {
          s += tileSvg(kindOf(id), x, 2, tw, th, { p: 'rs', d: 4, red: isRed(v.cfg, id) });
          x += tw;
        }
        x += 8;
      }
      return s + '</svg>';
    };
    const items = w.items.map((it) => `<li><span>${esc(it.name)}</span><b>${it.v ? it.v : ''}</b></li>`).join('');
    const ura = v.result?.ura?.length ? `<div class="m4-small">ура-дора: ${v.result.ura.map((id) => kindShort(doraOf(id))).join(', ')}</div>` : '';
    return `<div class="m4-win"><div class="m4-res-t">${this.ctx.name(w.seat)} — ${w.from < 0 ? 'цумо' : `рон на сбросе ${this.ctx.name(w.from)}`}</div>
      <div class="m4-res-scroll">${tilesSvg(w.hand, w.melds)}</div>
      <ul class="m4-items">${items}</ul><div class="m4-total">${esc(w.label)} · +${w.gain}</div>${ura}</div>`;
  }

  status(v: View, toAct: number[], interactive: number[]) {
    const me = this.viewer;
    if (v.phase === 'over') return 'Партия окончена';
    if (v.phase === 'end') return 'Раздача окончена';
    if (v.phase === 'missing') return interactive.includes(me) ? 'Выберите отсутствующую масть' : 'Выбирают масти…';
    if (v.phase === 'claim') return interactive.includes(me) ? 'Можно забрать сброс' : 'Ждём заявок…';
    const who = toAct[0];
    if (interactive.includes(who)) return v.turnOpts[who]?.tsumo ? 'Маджонг! Объявите цумо' : this.riichiMode ? 'Риичи: выберите сброс' : 'Ваш ход: сбросьте кость';
    return `Ходит ${this.ctx.name(who)}…`;
  }

  playerStats(v: View, seat: number) {
    return `${WIND_NAMES[v.p[seat].wind]}${seat === v.dealer ? ' (дилер)' : ''} · ${v.scores[seat]}`;
  }
}

function sortIds(ids: number[]): number[] {
  return [...ids].sort((a, b) => kindOf(a) - kindOf(b) || a - b);
}

function suggestMissing(v: View, seat: number): number {
  const by = [0, 0, 0];
  for (const id of v.p[seat].hand ?? []) by[suitOf(kindOf(id))]++;
  return by.indexOf(Math.min(...by));
}

export function createView(): GameView<View, Event> {
  return new Mahjong4View();
}
