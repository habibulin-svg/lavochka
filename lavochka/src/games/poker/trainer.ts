/* Покер — тренажёр за столом: HUD под табличками соперников (на 2D-столах; в 3D-комнате его нет — решение пользователя),
 * подсказки по желанию (шансы и ауты, шансы банка, сила руки, M и зона, пуш/фолд по Нэшу, ICM-цена) и разбор «лучший
 * ход» после каждой своей раздачи. Всё — по своему виду: HUD — только по ходам и вскрытым картам (годится и для сети),
 * подсказки и разбор — только в игре против ботов на этом устройстве (не по сети и не в хот-сите).
 * Панель — в слоте игры (ctx.controls), окна — поверх стола; панель стола (.voice, .tabs) не трогаем. */
import { SeededRng } from '../../core/rng';
import { store } from '../../core/settings';
import { esc, h } from '../../core/util';
import type { ViewCtx } from '../../core/view';
import { handEquity } from './ai';
import { bestMove, TIP_KEYS, tipsFor, type TipKey } from './calc';
import { recFor, type Event, type View } from './engine';
import { cleanName, loadHud, recordHand, recordTour, saveHud, statN, STATS, statVal, styleGuess, summaryOf, type StatKey } from './hud';
import { zero } from './stats';
import { syncPoker } from './cloud';

interface Prefs {
  hud: boolean;
  tips: boolean;
  /** В турнире на банкролл подсказки — отдельно (по умолчанию выключены: «чистый» результат). */
  tipsBank: boolean;
  best: boolean;
  keys: Record<TipKey, boolean>;
}
const PREF = 'poker.trainer';
const prefs = (): Prefs => {
  const p = store.get<Partial<Prefs>>(PREF, {});
  return { hud: p.hud ?? true, tips: p.tips ?? false, tipsBank: p.tipsBank ?? false, best: p.best ?? true, keys: { str: true, odds: true, pot: true, m: true, nash: true, icm: true, ...(p.keys ?? {}) } };
};

const MAIN: StatKey[] = ['vpip', 'pfr', 'threeBet', 'af'];
const vpipCls = (x: number) => (x < 15 ? 'tight' : x < 30 ? 'mid' : x < 45 ? 'loose' : 'wild');

export class Trainer {
  private p = prefs();
  private bar: HTMLElement;
  private tipsBox: HTMLElement;
  private bestBox: HTMLElement;
  private pop: HTMLElement;
  private v: View | null = null;
  private tipKey = '';
  private timer = 0;
  private lastBest = '';
  private seenTour = new Set<number>();

  constructor(
    root: HTMLElement,
    private ctx: ViewCtx
  ) {
    this.bar = h('<div class="pk-tr"></div>');
    this.tipsBox = h('<div class="pk-tips" hidden></div>');
    this.bestBox = h('<div class="pk-best" hidden></div>');
    this.pop = h('<div class="pk-pop" hidden></div>');
    if (!ctx.demo) {
      ctx.controls.prepend(this.bar);
      root.appendChild(this.pop);
      void syncPoker();
    }
    root.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-hud]') as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      this.openSeat(Number(el.dataset.hud));
    });
    this.pop.addEventListener('click', (e) => {
      const t = e.target as Element;
      if (t === this.pop || t.closest('.pk-pclose')) this.pop.hidden = true;
    });
    this.renderBar();
  }

  /** Подсказки и разбор — под кнопками хода (стол уже смонтировал свои): кнопки не уезжают вниз. */
  placeBelow() {
    if (!this.ctx.demo) this.ctx.controls.append(this.bestBox, this.tipsBox);
  }

  /** Человек один за этим экраном и играет не по сети — можно подсказывать. */
  private get me(): number {
    return this.ctx.mySeats.length === 1 ? this.ctx.mySeats[0] : -1;
  }
  private get solo() {
    return !this.ctx.demo && !this.ctx.online && this.me >= 0;
  }
  private get bankTour() {
    return !!this.v?.tour?.bank;
  }
  private get tipsOn() {
    return this.solo && (this.bankTour ? this.p.tipsBank : this.p.tips);
  }
  private save() {
    store.set(PREF, this.p);
  }
  private name(seat: number) {
    return cleanName(this.ctx.name(seat));
  }

  private renderBar() {
    if (this.ctx.demo) return;
    const tips = this.tipsOn;
    this.bar.innerHTML = `<button type="button" class="pk-trb${this.p.hud ? ' on' : ''}" data-k="hud" title="Цифры соперников под их табличками (на 2D-столе)">📊 HUD</button>${
      this.solo ? `<button type="button" class="pk-trb${tips ? ' on' : ''}" data-k="tips" title="${this.bankTour ? 'В турнире на банкролл — отдельный переключатель: без подсказок результат «чистый»' : 'Шансы, ауты, шансы банка, M, Нэш, ICM'}">💡 Подсказки${this.bankTour ? ' <small>банкролл</small>' : ''}</button><button type="button" class="pk-trb" data-k="set" aria-label="Что подсказывать">⚙</button>` : ''
    }`;
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('button'))
      b.onclick = () => {
        const k = b.dataset.k;
        if (k === 'hud') this.p.hud = !this.p.hud;
        else if (k === 'tips') {
          if (this.bankTour) this.p.tipsBank = !this.p.tipsBank;
          else this.p.tips = !this.p.tips;
        } else if (k === 'set') return this.openSettings();
        this.save();
        this.renderBar();
        this.tipKey = '';
        this.refreshTips();
        this.redraw?.();
      };
  }

  /** Перерисовать стол (HUD включили/выключили) — даёт SwitchView. */
  redraw: (() => void) | null = null;

  private openSettings() {
    this.pop.innerHTML = `<div class="pk-pbox"><div class="pk-phead"><b>Подсказки</b><button type="button" class="pk-pclose" aria-label="Закрыть">✕</button></div>
      ${TIP_KEYS.map((t) => `<label class="pk-pcheck"><input type="checkbox" data-t="${t.key}" ${this.p.keys[t.key] ? 'checked' : ''}> ${t.label}</label>`).join('')}
      <label class="pk-pcheck"><input type="checkbox" data-t="best" ${this.p.best ? 'checked' : ''}> Разбор «лучший ход» после раздачи</label>
      <p class="pk-pnote">Подсказки считают только по вашим картам и тому, что видно на столе, и работают в игре против ботов. В турнире на банкролл у них свой переключатель — по умолчанию выключен, чтобы результат был «чистым».</p></div>`;
    for (const i of this.pop.querySelectorAll<HTMLInputElement>('input'))
      i.onchange = () => {
        const t = i.dataset.t!;
        if (t === 'best') this.p.best = i.checked;
        else this.p.keys[t as TipKey] = i.checked;
        this.save();
        this.tipKey = '';
        this.refreshTips();
      };
    this.pop.hidden = false;
  }

  // ---------------------------------------------------------------- HUD

  /** Строка HUD под табличкой места (пусто — не показываем). */
  hud = (seat: number): string => {
    if (!this.p.hud || this.ctx.demo || this.ctx.mySeats.includes(seat)) return '';
    const c = loadHud().bots[this.name(seat)] ?? zero();
    const s = summaryOf(c);
    if (!s.hands) return `<span class="pk-hudv pk-few">нет данных</span>`;
    const few = s.hands < 30 ? ' pk-few' : '';
    return `<span class="pk-hudv pk-${vpipCls(s.vpip)}${few}" title="VPIP / PFR / 3-бет / AF · раздач">${MAIN.map((k) => statVal(s, k)).join('/')}<small>${s.hands}</small></span>`;
  };

  private openSeat(seat: number) {
    const nm = this.name(seat);
    const c = loadHud().bots[nm] ?? zero();
    const s = summaryOf(c);
    const guess = styleGuess(s);
    const rows = STATS.map((st) => {
      const n = statN(s, st.key);
      const val = statVal(s, st.key);
      const shaky = st.enough && n < st.enough ? ` <small class="pk-shaky" title="мало случаев — цифра неустойчивая">мало: ${n}</small>` : st.key !== 'hands' ? ` <small>из ${n}</small>` : '';
      return `<details class="pk-stat"><summary><span>${esc(st.name)}</span><b>${val}${st.key === 'hands' || st.key === 'af' || val === '—' ? '' : '%'}</b>${shaky}</summary>
        <p><b>Что значит:</b> ${st.what}</p><p><b>У стилей:</b> ${st.styles}</p><p><b>Как пользоваться:</b> ${st.use}</p></details>`;
    }).join('');
    this.pop.innerHTML = `<div class="pk-pbox"><div class="pk-phead"><b>${esc(nm)}</b>${guess ? `<span class="pk-guess">похоже: ${guess}</span>` : ''}<button type="button" class="pk-pclose" aria-label="Закрыть">✕</button></div>
      <p class="pk-pnote">Статистика копится по имени между партиями — только по тому, что видно за столом. Коснитесь цифры — что она значит и как ею пользоваться.</p>${rows}</div>`;
    this.pop.hidden = false;
  }

  // ---------------------------------------------------------------- события

  /** Снимок стола: подсказки и итог турнира. */
  update(v: View) {
    const was = this.bankTour;
    this.v = v;
    if (was !== this.bankTour) this.renderBar();
    this.trackTour(v);
    this.refreshTips();
  }

  private trackTour(v: View) {
    const T = v.tour;
    if (!T?.done || this.ctx.demo || this.seenTour.has(T.id)) return;
    const id = this.ctx.mySeats.map((s) => T.tables[0].ids[s]).find((x) => x >= 0 && T.players[x]?.human) ?? T.players.find((p) => p.human)?.id ?? -1;
    if (id < 0) return;
    this.seenTour.add(T.id);
    const p = T.players[id];
    const d = loadHud();
    if (recordTour(d, { id: String(T.id), fmt: T.fmt, place: p.out, field: T.players.reduce((a, x) => a + (x.joined ? x.entries : 0), 0), prize: p.prize + p.won, buyin: (p.entries + p.rebuys + (p.addon ? 1 : 0)) * T.buyin, bank: T.bank, at: Date.now() })) saveHud(d);
  }

  events(evs: Event[], v: View) {
    if (this.ctx.demo) return;
    for (const ev of evs) if (ev.type === 'hand') this.onHand(ev.rec, v);
  }

  private onHand(rec0: Extract<Event, { type: 'hand' }>['rec'], v: View) {
    // своими глазами: даже если пришло больше, чем видно этому экрану, — храним только своё
    const rec = recFor(rec0, this.ctx.mySeats);
    const names: Record<number, string> = {};
    for (const x of rec.seats) names[x.seat] = this.name(x.seat);
    const me = this.ctx.mySeats.length === 1 && rec.seats.some((x) => x.seat === this.ctx.mySeats[0]) ? this.ctx.mySeats[0] : -1;
    let best = '';
    let html = '';
    if (me >= 0 && this.solo) {
      const vd = bestMove(rec, me, v.cfg.prizes, (p) => names[p]);
      if (vd.kind !== 'none' && vd.short) {
        best = vd.short;
        html = vd.html;
      }
    }
    const d = loadHud();
    if (recordHand(d, rec, me, names, { tour: !!v.tour, prizes: v.cfg.prizes, best })) saveHud(d);
    if (best && this.p.best) this.showBest(best, html, rec.no);
  }

  private showBest(short: string, html: string, no: number) {
    const key = `${no}:${short}`;
    if (key === this.lastBest) return;
    this.lastBest = key;
    const ok = /верно|в порядке/.test(short);
    this.bestBox.innerHTML = `<button type="button" class="pk-bestb ${ok ? 'pk-good' : 'pk-bad'}">${ok ? '✅' : '🤔'} Раздача ${no}: ${esc(short)} <small>подробнее</small></button>`;
    this.bestBox.hidden = false;
    (this.bestBox.querySelector('button') as HTMLButtonElement).onclick = () => {
      this.pop.innerHTML = `<div class="pk-pbox"><div class="pk-phead"><b>Разбор раздачи ${no}</b><button type="button" class="pk-pclose" aria-label="Закрыть">✕</button></div>${html}</div>`;
      this.pop.hidden = false;
    };
  }

  // ---------------------------------------------------------------- подсказки

  private refreshTips() {
    const v = this.v;
    const me = this.me;
    if (!v || !this.tipsOn || me < 0 || !v.inHand.includes(me) || v.folded[me] || v.over || v.between || v.phase === 'over') {
      this.tipsBox.hidden = true;
      return;
    }
    const k = `${v.hand}:${v.street}:${v.phase}:${v.rec?.acts.length ?? 0}:${v.turn}`;
    if (k === this.tipKey) return;
    this.tipKey = k;
    const show = (eq: number | null) => {
      const t = tipsFor(v, me, eq, (p) => esc(this.name(p)));
      const lines = TIP_KEYS.filter((x) => this.p.keys[x.key] && t[x.key]).map((x) => `<div class="pk-tip"><span class="pk-tipl">${x.label}</span>${t[x.key]}</div>`);
      this.tipsBox.innerHTML = lines.length ? lines.join('') : '<div class="pk-tip">Подсказок к этому месту нет.</div>';
      this.tipsBox.hidden = false;
    };
    show(null);
    // шансы — розыгрышем, отдельно, чтобы не держать отрисовку
    if (this.p.keys.odds || this.p.keys.pot) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (this.tipKey !== k) return;
        try {
          show(handEquity(v, me, 260, new SeededRng(v.hand * 31 + v.street)));
        } catch {
          /* редкий вид без расчёта — без шансов */
        }
      }, 30) as unknown as number;
    }
  }

  destroy() {
    clearTimeout(this.timer);
    this.bar.remove();
    this.tipsBox.remove();
    this.bestBox.remove();
    this.pop.remove();
  }
}
