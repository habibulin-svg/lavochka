/* Холдем — отрисовка. Два вида, выбор — на экране игры (VIEW_PREF) и кнопкой за столом:
 * «стол» — овальное сукно сверху, как в покер-румах и других играх сборника (места по кругу, свои карты крупно снизу,
 * общие карты и банк в центре, ставки фишками перед игроками, баттон «D»); он же — показ правил и запасной без WebGL;
 * «3D-комната» — стол на three.js (scene3d.ts, грузится лениво) с людьми-видео, как в Apple poker: в кадре тот, кто
 * действует, — он думает, ставит (фишки летят из его стопки), пасует, вскрывается, радуется или расстраивается;
 * крупье раздаёт, собирает ставки, открывает флоп, двигает банк победителю.
 * Ход — кнопками: пас, чек/колл, рейз (окошко с числом, ползунок и быстрые суммы), ва-банк. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx, ViewPref } from '../../core/view';
import type { Options } from '../../core/types';
import { preloadDeck } from '../../cards/render';
import { settings, store } from '../../core/settings';
import type { Card } from '../../cards/deck';
import { CardStage, cardKey, type Point, type StageItem } from '../../cards/stage';
import type { Chips3D, Label3D, Table3D } from './scene3d';
import { DEALER, type DealerAct, type Gesture } from './people3d';
import { holding, minRaiseTo, toCall, toEvents, toView, type Event, type View } from './adapter';
import type { Event as PEvent, View as PView } from '../poker/engine';
import { SEATS } from '../poker/def';
import { LOADING } from './loading';
import './holdem.css';

const W = 1000;
const H = 720;
const C = { x: 500, y: 320 };
const GESTURE: Record<string, Gesture> = { fold: 'fold', check: 'check', call: 'call', raise: 'raise', allin: 'allin' };
export const VIEW_PREF: ViewPref = {
  key: 'holdem.view',
  label: 'Вид',
  choices: [
    { value: '3d', label: '3D-комната' },
    { value: '2d', label: 'Стол' },
  ],
  default: '3d',
  // 3D-комната — только у видов на две карты (холдем, Short Deck)
  showIf: (o: Options) => o.mode === 'holdem' || o.mode === 'shortdeck',
};
/** seat — 3D-комната; flat — стол сверху (он же показ правил и запасной без WebGL). */
type Mode = 'seat' | 'flat';
const MODE_NAME: Record<Mode, string> = { seat: '3D-комната', flat: 'стол' };
/** Люди-видео: через сколько мс от начала реакции рука дошла до фишек/карт и сколько ещё досматривать (скорость 1). */
const HIT: Record<string, number> = { fold: 950, check: 850, call: 1150, raise: 1250, allin: 950 };
const REST: Record<string, number> = { fold: 900, check: 650, call: 950, raise: 1150, allin: 1350 };

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Подпись поверх стола (и в плоском виде, и в 3D). */
interface Label extends Label3D {
  style?: string;
  /** Свои атрибуты элемента (обычный стол). */
  data?: string;
}

class HoldemView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private cover!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private hidden = false;
  private actSeat: number | null = null;
  private mode: Mode = 'seat';
  private gl: Table3D | null = null;
  private glHost!: HTMLElement;
  private glLoading = false;
  private canGl = false;
  /** «Пропустить»: раздачу (пока я снова не в игре) или всё до конца (вылетел). */
  private ff: 'hand' | 'game' | null = null;
  private skip!: HTMLButtonElement;
  /** Выигрыш раздачи: лежит кучкой перед победителем, пока не начнётся следующая. */
  private won = new Map<number, number>();

  /** HUD тренажёра под табличкой соперника — только на обычном столе (в 3D-комнате его нет). */
  constructor(private hud: ((seat: number) => string) | null = null) {}

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, W, H, 'hd-wrap', '<div class="hd-floor"></div><div class="hd-table"><div class="hd-felt"><div class="hd-print">Вечером на лавочке<small>♠ ♥ ♣ ♦</small></div></div></div>');
    this.cs.over.innerHTML = '<div class="hd-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.hd-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cover = h('<div class="cs-cover" hidden><div class="cs-cover-box"><div class="hd-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    this.glHost = h('<div class="hd-gl"></div>');
    this.cs.wrap.prepend(this.glHost);
    this.canGl = !ctx.demo && webglOk();
    this.mode = this.canGl && store.get<string>(VIEW_PREF.key, VIEW_PREF.default) !== '2d' ? 'seat' : 'flat';
    this.applyView();
    const ctl = h(`<div class="hd-controls"><div class="hd-btns"></div><button class="btn hd-skip" hidden></button><button class="btn hd-vbtn"></button></div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.hd-btns') as HTMLElement;
    this.skip = ctl.querySelector('.hd-skip') as HTMLButtonElement;
    this.skip.onclick = () => {
      Sound.unlock();
      const v = this.v;
      if (!v) return;
      this.setFF(this.busted(v) ? 'game' : 'hand');
    };
    const vb = ctl.querySelector('.hd-vbtn') as HTMLButtonElement;
    // без WebGL переключать нечего
    vb.hidden = ctx.demo || !this.canGl;
    const label = () => {
      const next: Mode = this.mode === 'seat' ? 'flat' : 'seat';
      vb.textContent = `Вид: ${MODE_NAME[this.mode]} → ${MODE_NAME[next]}`;
    };
    label();
    vb.onclick = () => {
      this.mode = this.mode === 'seat' ? 'flat' : 'seat';
      store.set(VIEW_PREF.key, this.mode === 'seat' ? '3d' : '2d');
      label();
      this.applyView();
      this.draw();
    };
  }

  private get is3d() {
    return this.mode === 'seat';
  }

  private applyView() {
    this.cs.wrap.classList.toggle('hd-webgl', this.is3d);
    this.cs.wrap.classList.toggle('hd-seatview', this.is3d);
    if (!this.is3d) {
      // ушли со стола в 3D — комнату гасим (ролики и отрисовка не крутятся впустую)
      this.gl?.destroy();
      this.gl = null;
      this.glHost.innerHTML = '';
      if (!this.glLoading) this.ctx.hold?.(0);
      return;
    }
    if (!this.gl && !this.glLoading) {
      this.glLoading = true;
      // заставка — сразу, пока грузится сама сцена (дальше её ведёт Table3D); боты пока не ходят
      this.glHost.insertAdjacentHTML('beforeend', LOADING);
      this.ctx.hold?.(30000);
      import('./scene3d')
        .then((m) => {
          this.glLoading = false;
          if (!this.cs.wrap.isConnected || !this.is3d) {
            this.glHost.innerHTML = '';
            this.ctx.hold?.(0);
            return;
          }
          this.gl = new m.Table3D(this.glHost, settings.deck, () => this.ctx.hold?.(0));
          this.gl.lookOf = (seat) => this.ctx.look?.(seat) ?? null;
          this.draw();
        })
        .catch((e) => {
          // не вышло (нет WebGL, не загрузилось) — обычный стол
          console.error(e);
          this.ctx.hold?.(0);
          this.glLoading = false;
          this.canGl = false;
          this.mode = 'flat';
          this.applyView();
          this.draw();
        });
    }
  }

  // ---------------------------------------------------------------- места

  private order(v: View): number[] {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  /** Место на овале: зритель снизу, дальше по часовой. */
  private anchor(v: View, seat: number): Point {
    const ord = this.order(v);
    const k = ord.indexOf(seat);
    const n = ord.length;
    let a = Math.PI / 2 + (k / n) * Math.PI * 2;
    if (this.is3d) {
      // в 3D посередине дальнего края стоит крупье: игроки — по кругу без этого места (поровну с двух сторон)
      const step = (Math.PI * 2) / (n + 1);
      const u = k * step;
      a = Math.PI / 2 + (u < Math.PI - step / 2 - 1e-6 ? u : u + step);
    }
    return { x: C.x + Math.cos(a) * 410, y: C.y + Math.sin(a) * 250 + (k === 0 && !this.is3d ? 20 : 0) };
  }

  private chooseViewer(v: View, toAct: number[]) {
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    if (!mine.length) return;
    if (mine.length === 1) {
      this.viewer = mine[0];
      return;
    }
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && next !== this.viewer) {
      this.viewer = next;
      this.hidden = true;
      this.cs.clear();
    }
  }

  /** Свои карты: открытые, рубашкой (за одним экраном — пока не нажали «Показать карты») или null — карт нет. */
  private myCards(v: View): (Card | null)[] | null {
    if (!v.seats.includes(this.viewer) || !holding(v, this.viewer)) return null;
    // карт нет (крупье собрал) — нечего и показывать
    if (!v.hole[this.viewer].length) return null;
    return !this.hidden || this.ctx.demo ? v.hole[this.viewer] : [null, null];
  }

  private layout(v: View): (StageItem & { seat?: number; i?: number })[] {
    const items: (StageItem & { seat?: number; i?: number })[] = [];
    const g = this.is3d;
    // в 3D общие карты мельче и теснее — стол виден в перспективе
    v.board.forEach((c, i) => items.push({ key: cardKey(c), card: c, x: C.x + (g ? (i - 2) * 104 : -184 + i * 92), y: C.y - (g ? 30 : 10), r: 0, s: g ? 0.96 : 0.86, z: 10 + i }));
    for (const seat of v.seats) {
      if (!holding(v, seat)) continue;
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      // «за столом» свои карты — крупно в углу экрана, на столе их нет
      if (me && g) continue;
      const cards = me ? this.myCards(v) : v.hole[seat].length ? v.hole[seat] : [null, null];
      if (!cards) continue;
      const toward = { x: (C.x - a.x) * (g ? 0.16 : 0.12), y: (C.y - a.y) * (g ? 0.16 : 0.12) };
      // в 3D карты чуть развёрнуты к центру, но читаются со своего места
      const face = g ? (Math.atan2(C.x - a.x, Math.abs(C.y - a.y) + 120) * 90) / Math.PI : 0;
      cards.forEach((c, i) => {
        // в 3D у всех карты одного размера с общими
        const s = me ? (g ? 0.96 : 0.86) : g ? 0.96 : 0.5;
        const x = a.x + toward.x + (i - 0.5) * (me ? 64 : g ? 48 : 30);
        const y = a.y + toward.y - (me && !g ? 40 : 0);
        const r = face + (i - 0.5) * (me ? 8 : 12);
        items.push(c ? { key: cardKey(c), card: c, x, y, r, s, z: (me ? 100 : 50) + i, seat, i } : { key: `b:${seat}:${i}`, card: null, x, y, r, s, z: 50 + i, seat, i });
      });
    }
    return items;
  }

  private draw(enter: Point | null = null, exit: Point | null = null) {
    const v = this.v;
    if (!v) return;
    const items = this.layout(v);
    this.cs.render(items, this.speed, enter, exit);
    const gl = this.is3d && this.gl;
    const labels: Label[] = [];
    const chips: Chips3D[] = [];
    let button: (Point & { seat: number }) | null = null;
    // выигрыш уже у победителя (кучкой перед ним), но в стопку ещё не лёг
    const won = [...this.won.values()].reduce((a, x) => a + x, 0);
    const potAll = v.inHand.reduce((a, x) => a + v.total[x], 0) - won;
    // в 3D банк — фишки прошлых кругов; ставки этого круга лежат перед игроками
    const pot = potAll - v.seats.reduce((a, x) => a + v.bet[x], 0);
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const busted = v.chips[seat] <= 0 && !v.inHand.includes(seat);
      const out = v.folded[seat];
      const on = v.turn === seat && v.phase !== 'over';
      const tag = v.allin[seat] ? ' <em>ва-банк</em>' : out ? ' <em>пас</em>' : busted ? ' <em>вылетел</em>' : '';
      const py = me ? a.y + 62 : a.y + 46;
      labels.push({ cls: `cs-plate hd-plate${on ? ' on' : ''}${out || busted ? ' hd-dim' : ''}`, style: `--c:${SEATS[seat].color}`, x: a.x, y: py, seat, html: `${esc(this.plain(seat))} <i>${v.chips[seat]}</i>${tag}` });
      const hud = gl || me ? '' : (this.hud?.(seat) ?? '');
      if (hud) labels.push({ cls: 'pk-hud', x: a.x, y: py + 34, html: hud, data: `data-hud="${seat}"` });
      // ставка этого круга — фишками к центру; своя — справа от карт, чужие — по пути к центру
      if (v.bet[seat] > 0) {
        const k = gl ? 0.42 : 0.36;
        const bx = me && !gl ? a.x + 130 : a.x + (C.x - a.x) * k;
        const by = me && !gl ? a.y - 70 : a.y + (C.y - a.y) * k;
        if (gl) {
          chips.push({ key: `bet:${seat}`, x: bx, y: by, amount: v.bet[seat], seat });
          labels.push({ cls: 'hd-bet hd-bet-gl', x: bx, y: by, h: 0.6, chip: `bet:${seat}`, html: `<span>${v.bet[seat]}</span>` });
        } else labels.push({ cls: 'hd-bet', x: bx, y: by, html: `${this.chipStack(v.bet[seat])}<span>${v.bet[seat]}</span>` });
      }
      // фишки игрока — у борта, сбоку от карт
      const win = this.won.get(seat);
      if (win) {
        const wx = a.x + (C.x - a.x) * 0.3;
        const wy = a.y + (C.y - a.y) * 0.3;
        if (gl) {
          chips.push({ key: `win:${seat}`, x: wx, y: wy, amount: win, seat });
          labels.push({ cls: 'hd-bet hd-bet-gl', x: wx, y: wy, h: 0.7, chip: `win:${seat}`, html: `<span>+${win}</span>` });
        } else labels.push({ cls: 'hd-bet', x: wx, y: wy, html: `${this.chipStack(win)}<span>+${win}</span>` });
      }
      if (gl && v.chips[seat] > 0) {
        const t = { x: -(a.y - C.y) * (410 / 250), y: (a.x - C.x) * (250 / 410) };
        const tl = Math.hypot(t.x, t.y) || 1;
        const side = me ? 150 : 95;
        chips.push({ key: `stk:${seat}`, x: a.x + (t.x / tl) * side + (C.x - a.x) * 0.05, y: a.y + (t.y / tl) * side * 0.8 + (C.y - a.y) * 0.05, amount: v.chips[seat], bank: true, seat });
      }
      if (seat === v.button && v.phase !== 'over') {
        button = { x: a.x + (C.x - a.x) * 0.24 + 46, y: a.y + (C.y - a.y) * 0.24 - 10, seat };
        if (!gl) labels.push({ cls: 'hd-button', x: button.x, y: button.y, html: 'D' });
      }
    }
    if (gl) {
      if (pot > 0) chips.push({ key: 'pot', x: C.x, y: C.y + 125, amount: pot });
      if (potAll) labels.push({ cls: 'hd-pot hd-bet-gl', x: C.x + 95, y: C.y + 125, h: 0.1, html: `<span>банк ${potAll}</span>` });
    } else if (potAll) labels.push({ cls: 'hd-pot', x: C.x, y: C.y + 70, html: `${this.chipStack(potAll)}<span>банк ${potAll}</span>` });
    const blinds = `<div class="hd-blinds">${v.title ? `${esc(v.title)} · ` : ''}блайнды ${v.big / 2}/${v.big} · раздача ${v.hand}</div>`;
    if (gl) {
      this.plates.innerHTML = blinds;
      const g3 = this.gl!;
      g3.setDeck(settings.deck);
      g3.setSeats(v.seats.map((seat) => ({ seat, ...this.anchor(v, seat), me: seat === this.viewer, out: v.chips[seat] <= 0 && !v.inHand.includes(seat) })));
      g3.setFocus(v.phase !== 'over' ? v.turn : null);
      g3.setHand(this.myCards(v));
      g3.setBoard(v.board, potAll, `блайнды ${v.big / 2}/${v.big}`);
      g3.set(
        items.map((it, i) => ({ key: it.key, card: it.card, x: it.x, y: it.y, r: it.r, s: it.s, board: i < v.board.length, seat: it.seat, i: it.i })),
        chips,
        button,
        labels,
        this.speed,
        enter,
        exit
      );
      return;
    }
    this.plates.innerHTML = labels.map((l) => `<div class="${l.cls}" ${l.data ?? ''} style="${l.style ? l.style + ';' : ''}left:${l.x}px;top:${l.y}px">${l.html}</div>`).join('') + blinds;
  }

  /** Стопка фишек по номиналам 500/100/25/5. */
  private chipStack(n: number): string {
    const kinds = [
      { v: 500, c: 'p' },
      { v: 100, c: 'k' },
      { v: 25, c: 'g' },
      { v: 5, c: 'r' },
    ];
    let out = '';
    let left = n;
    let total = 0;
    for (const k of kinds) {
      const cnt = Math.min(6, Math.floor(left / k.v));
      left -= cnt * k.v;
      for (let i = 0; i < cnt && total < 10; i++, total++) out += `<b class="hd-chip ${k.c}" style="--i:${total}"></b>`;
    }
    if (!total) out = '<b class="hd-chip r" style="--i:0"></b>';
    return `<div class="hd-stack">${out}</div>`;
  }

  /** Скорость анимаций: при «пропустить» — почти мгновенно. */
  private get speed() {
    return this.ctx.speed() * (this.ff ? 25 : 1);
  }

  private busted(v: View) {
    return v.seats.includes(this.viewer) && v.chips[this.viewer] <= 0 && !v.inHand.includes(this.viewer);
  }

  private setFF(m: 'hand' | 'game' | null) {
    this.ff = m;
    this.ctx.hurry?.(!!m);
    this.gl?.setFast(!!m);
    this.renderSkip();
  }

  /** Кнопка «пропустить»: я сбросил карты (или вылетел), а боты доигрывают. */
  private renderSkip() {
    const v = this.v;
    const mine = v && !this.ctx.demo && v.phase !== 'over' && v.seats.includes(this.viewer) && this.ctx.mySeats.length < v.seats.length;
    const busted = !!mine && this.busted(v!);
    const folded = !!mine && !busted && (!v!.inHand.includes(this.viewer) || v!.folded[this.viewer]);
    this.skip.hidden = !(busted || folded) || !!this.ff;
    this.skip.textContent = busted ? '⏭ Досмотреть быстро до конца' : '⏭ Пропустить раздачу';
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private send(a: Parameters<ViewCtx['act']>[1]) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, a);
  }

  private clearTurn() {
    this.actSeat = null;
    this.btns.innerHTML = '';
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null || this.ctx.demo || this.hidden) return;
    const call = toCall(v, seat);
    const stack = v.chips[seat];
    const pot = v.inHand.reduce((a, x) => a + v.total[x], 0);
    const max = v.bet[seat] + stack;
    const min = Math.min(max, minRaiseTo(v, seat));
    const row = h('<div class="hd-row"></div>');
    const add = (text: string, cls: string, on: () => void) => {
      const b = h<HTMLButtonElement>(`<button class="btn ${cls}">${text}</button>`);
      b.onclick = () => {
        Sound.unlock();
        on();
      };
      row.appendChild(b);
    };
    add('Пас', '', () => this.send({ type: 'fold' }));
    if (call === 0) add('Чек', 'primary', () => this.send({ type: 'check' }));
    else add(call >= stack ? `Колл ва-банк ${stack}` : `Колл ${call}`, 'primary', () => this.send({ type: 'call' }));
    this.btns.appendChild(row);
    if (stack > call) {
      // окошко ставки: число вводится с клавиатуры, −/+ по малому блайнду, ползунок и быстрые суммы
      const step = Math.max(1, Math.round(v.big / 2));
      const word = v.current > 0 ? 'Рейз до' : 'Ставка';
      const box = h(`<div class="hd-raise">
        <div class="hd-amt">
          <button class="btn hd-step" data-d="-1" aria-label="меньше">−</button>
          <label class="hd-field"><span>${word}</span><input type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${min}"></label>
          <button class="btn hd-step" data-d="1" aria-label="больше">+</button>
        </div>
        <input class="hd-range" type="range" min="${min}" max="${max}" step="${step}" value="${min}">
        <div class="hd-row hd-quick"></div>
        <button class="btn primary hd-go"></button>
      </div>`);
      const field = box.querySelector('.hd-field input') as HTMLInputElement;
      const range = box.querySelector('.hd-range') as HTMLInputElement;
      const go = box.querySelector('.hd-go') as HTMLButtonElement;
      const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
      const show = (n: number, fromField = false) => {
        if (!fromField) field.value = String(n);
        range.value = String(n);
        const ok = Number.isFinite(n) && n >= min && n <= max;
        go.disabled = !ok;
        go.textContent = !ok ? `от ${min} до ${max}` : n >= max ? `Ва-банк ${max}` : `${word} ${n}`;
      };
      field.oninput = () => show(Number(field.value), true);
      field.onchange = () => show(clamp(Number(field.value) || min));
      field.onfocus = () => field.select();
      field.onkeydown = (e) => {
        if (e.key === 'Enter') {
          show(clamp(Number(field.value) || min));
          go.click();
        }
      };
      range.oninput = () => show(Number(range.value));
      for (const b of box.querySelectorAll<HTMLButtonElement>('.hd-step'))
        b.onclick = () => show(clamp((Number(field.value) || min) + Number(b.dataset.d) * step));
      const quick = box.querySelector('.hd-quick') as HTMLElement;
      const q = (text: string, to: number) => {
        const b = h<HTMLButtonElement>(`<button class="btn">${text}</button>`);
        b.onclick = () => show(clamp(to));
        quick.appendChild(b);
      };
      q('мин', min);
      q('½ банка', v.current + pot / 2);
      q('банк', v.current + pot);
      q('ва-банк', max);
      go.onclick = () => {
        Sound.unlock();
        const to = clamp(Number(field.value) || min);
        this.send(to >= max ? { type: 'allin' } : { type: 'raise', to });
      };
      show(min);
      this.btns.appendChild(box);
    }
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.v = v;
    this.banner.hidden = true;
    this.draw();
    this.renderSkip();
  }

  private bannerTimer: ReturnType<typeof setTimeout> | undefined;
  /** Надпись поверх стола на ms (0 — пока не уберут); noWait — не ждать, пока она уйдёт. */
  private async showBanner(text: string, ms: number, noWait = false) {
    clearTimeout(this.bannerTimer);
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (!ms) return;
    if (noWait) {
      this.bannerTimer = setTimeout(() => (this.banner.hidden = true), ms);
      return;
    }
    await sleep(ms);
    this.banner.hidden = true;
  }

  async play(events: Event[], v: View) {
    this.clearTurn();
    // «пропустить»: без пауз и без людей в кадре
    const gl = () => (this.ff ? null : this.gl);
    // люди-видео: камера показывает каждое событие (кто действует, крупье) и ждёт, пока доиграет реакция
    const dir = () => !!gl()?.director;
    // с людьми-видео ускоряем не больше чем в 1,6 раза: быстрее живые люди дёргаются, как в немом кино
    const sp = () => (dir() ? Math.min(1.6, this.ctx.speed()) : this.ctx.speed());
    const pause = (ms: number) => (this.ff ? Promise.resolve() : sleep(ms / sp()));
    const shoot = (seat: number | null) => gl()?.shoot(seat);
    const dealer = (a: DealerAct) => gl()?.dealer(a);
    const snd = (f: () => void) => {
      if (!this.ff) f();
    };
    this.gl?.setRate(1.25 * Math.min(1.6, this.ctx.speed()));
    const zero = () => this.v!.bet.map(() => 0);
    /** Ставки круга — в банк (крупье сгребает). */
    const collect = async () => {
      if (!this.v!.bet.some((b) => b > 0)) return;
      if (dir()) {
        shoot(DEALER);
        dealer('collect');
        await pause(1100);
      }
      this.v = { ...this.v!, bet: zero() };
      this.draw();
      snd(() => Sound.place());
      await pause(dir() ? 600 : 0);
    };
    const winners = new Set(events.flatMap((e) => (e.type === 'win' ? [e.seat] : [])));
    const lost = new Set<number>();
    let shown = false;
    try {
      for (const ev of events) {
        const cur = this.v!;
        if (ev.type === 'act') {
          const bet = cur.bet.slice();
          const chips = cur.chips.slice();
          const total = cur.total.slice();
          bet[ev.seat] += ev.amount;
          chips[ev.seat] -= ev.amount;
          total[ev.seat] += ev.amount;
          const folded = cur.folded.slice();
          if (ev.action === 'fold') folded[ev.seat] = true;
          // походил — уже не думает (после реакции — просто ждёт)
          const after = { ...cur, bet, chips, total, folded, turn: -1 };
          const other = ev.seat !== this.viewer;
          if (dir()) {
            // камера на нём; рука тянется к фишкам — фишки летят, когда она до них дошла
            shoot(ev.seat);
            if (other) {
              gl()?.gesture(ev.seat, GESTURE[ev.action]);
              await pause(HIT[ev.action]);
            }
          } else gl()?.gesture(ev.seat, GESTURE[ev.action]);
          this.v = after;
          this.draw(null, ev.action === 'fold' ? { x: C.x, y: C.y } : null);
          if (ev.action === 'fold') snd(() => Sound.card());
          else if (ev.action === 'check') snd(() => Sound.ui());
          else snd(() => Sound.place());
          await pause(dir() ? (other ? REST[ev.action] : 700) : 380);
          // ва-банк — крупье уважительно кивает
          if (dir() && ev.action === 'allin') {
            shoot(DEALER);
            dealer('allin');
            await pause(1500);
          }
        } else if (ev.type === 'street') {
          await collect();
          if (dir()) {
            shoot(DEALER);
            dealer(ev.street === 'flop' ? 'flop' : 'card');
            // рука крупье над серединой стола — карты ложатся
            await pause(ev.street === 'flop' ? 700 : 900);
          } else dealer(ev.street === 'flop' ? 'flop' : 'card');
          this.v = { ...this.v!, board: [...this.v!.board, ...ev.cards], bet: zero() };
          this.draw({ x: C.x, y: C.y - 200 });
          snd(() => Sound.card());
          await pause(dir() ? 1300 : 520);
        } else if (ev.type === 'show') {
          if (!shown) {
            await collect();
            if (!dir()) dealer('collect');
          }
          shown = true;
          // вскрытие: камера на нём, карты переворачиваются у него на столе (мои — в углу, в кадре крупье)
          if (dir()) {
            shoot(ev.seat);
            await pause(500);
          }
          const hole = this.v!.hole.slice();
          hole[ev.seat] = ev.cards;
          this.v = { ...this.v!, hole };
          this.draw();
          snd(() => Sound.card());
          if (dir() && ev.seat !== this.viewer) {
            await pause(1400);
            // не взял ничего — расстроился
            if (!winners.has(ev.seat)) {
              lost.add(ev.seat);
              gl()?.gesture(ev.seat, 'lose');
              await pause(2200);
            }
          } else await pause(500);
        } else if (ev.type === 'win') {
          await collect();
          // крупье двигает банк к победителю: к нам, влево или вправо (как видит камера, глядя на неё)
          const wa = this.anchor(cur, ev.seat);
          const push: DealerAct = ev.seat === this.viewer || Math.abs(wa.x - C.x) < 60 ? 'push_front' : wa.x < C.x ? 'push_left' : 'push_right';
          if (dir()) {
            if (!ev.uncontested) {
              shoot(DEALER);
              dealer(push);
              await pause(1300);
            }
            // победитель: фишки едут к нему, он радуется и сгребает
            shoot(ev.seat);
            if (ev.seat !== this.viewer) gl()?.gesture(ev.seat, 'win');
            await pause(ev.seat !== this.viewer ? 900 : 300);
          } else {
            // вскрылись и не взяли — расстроились (раз за раздачу)
            if (!ev.uncontested && !lost.size)
              cur.hole.forEach((hh, seat) => {
                if (hh.length && !cur.folded[seat] && !winners.has(seat) && !lost.has(seat)) {
                  lost.add(seat);
                  gl()?.gesture(seat, 'lose', 0.3);
                }
              });
            gl()?.gesture(ev.seat, 'win');
            dealer(push);
          }
          this.won.set(ev.seat, (this.won.get(ev.seat) ?? 0) + ev.amount);
          this.draw();
          snd(() => Sound.win());
          await this.showBanner(`${this.plain(ev.seat)} +${ev.amount}${ev.hand ? ` — ${ev.hand}` : ''}`, (dir() ? 2000 : 1400) / sp(), this.ff === 'game');
        } else if (ev.type === 'blinds') {
          await this.showBanner(`Блайнды ${ev.big / 2}/${ev.big}`, 900 / this.ctx.speed(), !!this.ff);
        } else if (ev.type === 'deal') {
          // пропущенная раздача кончилась — дальше как обычно (вылетел — кнопка предложит досмотреть до конца)
          if (this.ff === 'hand') this.setFF(null);
          // выигрыш — в стопку победителя
          this.won.clear();
          if (dir()) {
            shoot(DEALER);
            // со второй раздачи сначала собирает карты прошлой
            if (ev.hand > 1) {
              dealer('gather');
              this.v = { ...this.v!, board: [], hole: this.v!.hole.map(() => []), chips: v.chips };
              this.draw(null, { x: C.x, y: C.y - 200 });
              await pause(1300);
            }
            dealer(ev.hand === 1 ? 'hello' : 'deal');
            await pause(ev.hand === 1 ? 1300 : 500);
            if (ev.hand === 1) dealer('deal');
          } else dealer(ev.hand === 1 ? 'hello' : 'deal');
          snd(() => Sound.shuffle());
          this.v = { ...v };
          this.draw({ x: C.x, y: C.y - 200 });
          // карты долетели — все заглядывают в свои (вразнобой; в кадр попадёт тот, кто ходит первым)
          for (const seat of ev.seats) gl()?.gesture(seat, 'look', (dir() ? 1.6 : 0.8) + Math.random() * 1.2);
          if (dir()) {
            await pause(1500);
            // крупье показывает, кто начинает
            const first = v.turn;
            if (first != null && first !== this.viewer && v.phase !== 'over') {
              const fa = this.anchor(v, first);
              dealer(Math.abs(fa.x - C.x) < 60 ? 'point_front' : fa.x < C.x ? 'point_left' : 'point_right');
              await pause(1100);
            }
          }
        } else if (ev.type === 'bust') {
          if (ev.seat === this.viewer && this.ctx.mySeats.length < v.seats.length) await this.showBanner('Вы вылетели — боты доигрывают без вас', 1600 / this.ctx.speed());
        } else if (ev.type === 'end') {
          if (this.ff) this.setFF(null);
          snd(() => Sound.win());
          this.v = v;
          this.draw();
          await this.showBanner(`Все фишки — ${this.plain(ev.winner)}!`, 0);
        }
      }
    } finally {
      // события показаны — камера снова у того, чей ход
      this.gl?.shoot(null);
    }
    this.v = v;
    this.draw({ x: C.x, y: C.y - 200 });
    this.renderSkip();
    // ходит бот — он «думает» (камера уже на нём): не мгновенно, но и не томительно
    if (!this.ff && v.phase !== 'over' && v.turn != null && !this.ctx.mySeats.includes(v.turn) && events.some((e) => e.type === 'act' || e.type === 'deal' || e.type === 'street'))
      await sleep(((dir() ? 1000 : 700) + Math.random() * 900) / sp());
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const v = this.v;
    if (!v || v.phase === 'over' || this.ctx.demo) return;
    this.chooseViewer(v, toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.hd-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
      this.cover.hidden = false;
    } else {
      this.hidden = false;
      this.cover.hidden = true;
    }
    this.actSeat = seat;
    this.draw();
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    if (v.phase === 'over') return v.winner != null ? `Все фишки у ${name(v.winner)}` : 'Игра окончена';
    const who = toAct[0];
    if (!interactive.includes(who)) return `Думает ${name(who)}…`;
    const call = toCall(v, who);
    return call ? `Ваш ход: колл ${call}?` : 'Ваш ход';
  }

  playerStats(v: View, seat: number) {
    return v.chips[seat] > 0 || v.inHand.includes(seat) ? `фишки: ${v.chips[seat]}` : 'вылетел';
  }

  destroy() {
    this.ctx.hold?.(0);
    if (this.ff) this.ctx.hurry?.(false);
    this.gl?.destroy();
    this.gl = null;
    this.cs.destroy();
  }
}

/** Стол холдема на общем движке покера: View и события движка — через переходник (adapter.ts). */
export function createView(hud: ((seat: number) => string) | null = null): GameView<PView, PEvent> {
  const inner = new HoldemView(hud);
  return {
    mount: (root, ctx) => inner.mount(root, ctx),
    setView: (v) => inner.setView(toView(v)),
    play: (evs, v) => inner.play(toEvents(evs), toView(v)),
    setTurn: (a, i) => inner.setTurn(a, i),
    status: (v, a, i) => inner.status(toView(v), a, i),
    playerStats: (v, seat) => inner.playerStats(toView(v), seat),
    destroy: () => inner.destroy(),
  };
}
