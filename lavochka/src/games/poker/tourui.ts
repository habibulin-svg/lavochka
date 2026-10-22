/* Покер — экран турнира поверх стола (любого: 3D-комната холдема или 2D): строка над столом (уровень, до роста, место,
 * средний стек, M и зона Харрингтона), по касанию — подробно (лидеры, призовые, баунти), решения «ребай / ре-энтри / аддон»,
 * ребай по желанию и итог с местом. Учёт виртуального банкролла — здесь же (poker/bankroll.ts). */
import { esc, h } from '../../core/util';
import type { ViewCtx } from '../../core/view';
import type { View } from './engine';
import { trackTour } from './bankroll';
import { anteAt, anteTotal, bigAt, canVoluntaryRebuy, entriesOf, FMTS, KINDS, SPEEDS, type TourState } from './tour';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Зона Харрингтона по M (сколько кругов блайндов и анте протянет стек). */
export function zone(m: number): { id: string; label: string; tip: string } {
  if (m >= 20) return { id: 'green', label: 'зелёная', tip: 'играй во всю силу: стек глубокий' };
  if (m >= 10) return { id: 'yellow', label: 'жёлтая', tip: 'спекулятивные руки дешеветь перестали — играй плотнее' };
  if (m >= 6) return { id: 'orange', label: 'оранжевая', tip: 'пора первым входить в банк рейзом или ва-банком' };
  if (m >= 1) return { id: 'red', label: 'красная', tip: 'только пуш или пас — ждать нечего' };
  return { id: 'dead', label: 'мёртвая', tip: 'ва-банк с любыми двумя картами' };
}

/** Кто «я» в турнире: человек за этим экраном. */
function meOf(T: TourState, ctx: ViewCtx): number {
  for (const s of ctx.mySeats) {
    const id = T.tables[0].ids[s];
    if (id >= 0 && T.players[id].human) return id;
  }
  return T.players.find((p) => p.human)?.id ?? -1;
}

export class TourUI {
  private bar: HTMLElement;
  private panel: HTMLElement;
  private ask: HTMLElement;
  private rebuyBtn: HTMLButtonElement;
  private T: TourState | null = null;
  private shownEnd = false;

  constructor(
    root: HTMLElement,
    private ctx: ViewCtx,
  ) {
    root.classList.add('pk-tour-host');
    this.bar = h('<button class="pk-tbar" type="button" title="Турнир: подробно" hidden></button>');
    this.panel = h('<div class="pk-tpanel" hidden></div>');
    this.ask = h('<div class="pk-task" hidden></div>');
    root.append(this.bar, this.panel, this.ask);
    this.bar.onclick = () => this.open(!this.panel.hidden ? false : true);
    this.rebuyBtn = h<HTMLButtonElement>('<button class="btn pk-rebuy" type="button" hidden>Ребай</button>');
    ctx.controls.appendChild(this.rebuyBtn);
    this.rebuyBtn.onclick = () => {
      const seat = this.mySeat();
      if (seat >= 0) ctx.act(seat, { type: 'tour', what: 'rebuy' });
    };
  }

  private mySeat() {
    const T = this.T;
    if (!T) return -1;
    const me = meOf(T, this.ctx);
    return T.tables[0].ids.indexOf(me);
  }

  update(v: View) {
    const T = v.tour;
    this.T = T ?? null;
    if (!T) {
      this.bar.hidden = this.panel.hidden = this.ask.hidden = this.rebuyBtn.hidden = true;
      return;
    }
    const me = meOf(T, this.ctx);
    if (me >= 0 && !this.ctx.demo) trackTour(T, me);
    this.bar.hidden = false;
    this.bar.innerHTML = this.barHtml(T, me);
    // решение за этим экраном
    const d = v.decide;
    if (d && this.ctx.mySeats.includes(d.seat) && !this.ctx.demo) {
      const what = d.what;
      const text =
        what === 'addon'
          ? `Перерыв. <b>Аддон</b>: +${fmt(T.addonChips)} фишек за ${T.buyin} очков?`
          : what === 'rebuy'
            ? `Фишки кончились. <b>Ребай</b>: снова ${fmt(T.start)} фишек за ${T.buyin} очков?`
            : `Вы вылетели. Ещё идёт поздняя регистрация — <b>войти снова</b> (${fmt(T.start)} фишек за ${T.buyin} очков)?`;
      this.ask.innerHTML = `<div class="pk-task-box"><p>${text}</p><div class="pk-row"><button class="btn primary" data-a="yes">${what === 'addon' ? 'Взять' : what === 'rebuy' ? 'Ребай' : 'Войти снова'}</button><button class="btn" data-a="no">${what === 'addon' ? 'Не нужно' : 'Нет, выхожу'}</button></div></div>`;
      for (const b of this.ask.querySelectorAll<HTMLButtonElement>('button'))
        b.onclick = () => {
          this.ask.hidden = true;
          this.ctx.act(d.seat, { type: 'tour', what: b.dataset.a as 'yes' | 'no' });
        };
      this.ask.hidden = false;
    } else this.ask.hidden = true;
    const seat = this.mySeat();
    this.rebuyBtn.hidden = !(seat >= 0 && canVoluntaryRebuy(v, seat));
    if (!this.rebuyBtn.hidden) this.rebuyBtn.textContent = `Ребай: +${fmt(T.start)} фишек за ${T.buyin} очков`;
    if (T.done && !this.shownEnd) {
      this.shownEnd = true;
      this.open(true);
    } else if (!this.panel.hidden) this.panel.innerHTML = this.panelHtml(T, me);
  }

  private open(on: boolean) {
    if (!this.T) return;
    this.panel.hidden = !on;
    if (on) {
      this.panel.innerHTML = this.panelHtml(this.T, meOf(this.T, this.ctx));
      (this.panel.querySelector('.pk-tclose') as HTMLButtonElement).onclick = () => this.open(false);
    }
  }

  /** Строка над столом. */
  private barHtml(T: TourState, me: number): string {
    const big = bigAt(T.mtt, T.level);
    const ak = anteAt(T.mtt, T.level);
    const ante = ak === 'none' ? '' : ` · анте ${ak === 'bb' ? fmt(big) : fmt(Math.max(1, Math.round(big / 10)))}`;
    const left = T.levelSec - (T.t % T.levelSec);
    const alive = T.players.filter((p) => p.joined && !p.out);
    const parts = [`<b>Ур. ${T.level + 1}</b> ${fmt(big / 2)}/${fmt(big)}${ante}`, T.done ? '' : `⏱ ${mmss(left)}`];
    const p = T.players[me];
    if (p && !T.done) {
      if (p.out) parts.push(p.out > 0 ? `вы — ${p.out}-е место` : 'вы выбыли');
      else {
        const rank = alive.slice().sort((a, b) => b.chips - a.chips).findIndex((x) => x.id === me) + 1;
        const m = this.mOf(T, p.chips);
        const z = zone(m);
        parts.push(`место ${rank}/${alive.length}`, `M <span class="pk-z pk-z-${z.id}">${m < 100 ? m.toFixed(1) : '99+'}</span>`);
      }
    }
    if (T.done) parts.push(p ? `🏁 ${p.out}-е место${p.prize + p.won ? ` · +${fmt(p.prize + p.won)}` : ''}` : '🏁 турнир окончен');
    return parts.filter(Boolean).join(' · ') + ' <span class="pk-tmore">▾</span>';
  }

  private mOf(T: TourState, chips: number) {
    const n = Math.max(2, T.tables[0].ids.filter((id) => id >= 0 && T.players[id].chips > 0).length);
    const big = bigAt(T.mtt, T.level);
    return chips / (big * 1.5 + anteTotal(T.mtt, T.level, n));
  }

  private panelHtml(T: TourState, me: number): string {
    const p = T.players[me];
    const alive = T.players.filter((x) => x.joined && !x.out).sort((a, b) => b.chips - a.chips);
    const entries = entriesOf(T);
    const avg = alive.length ? T.chipsIn / alive.length : 0;
    const big = bigAt(T.mtt, T.level);
    const next = bigAt(T.mtt, T.level + 1);
    const left = T.levelSec - (T.t % T.levelSec);
    const F = FMTS[T.fmt];
    const title = `${F.mtt ? 'Турнир' : F.don ? '' : 'Sit&Go'} ${F.label} · ${SPEEDS[T.speed].label.toLowerCase()} · ${KINDS[T.kind].toLowerCase()}`;
    const rows: string[] = [];
    if (T.done) {
      const top = T.players.filter((x) => x.out).sort((a, b) => a.out - b.out).slice(0, Math.max(T.paid, 3));
      rows.push(
        `<h4>Итог</h4>${p ? `<p class="pk-tres">Вы — <b>${p.out}-е место из ${entries}</b>${p.prize + p.won ? `, выигрыш <b>${fmt(p.prize + p.won)}</b> очков` : ', без приза'}${T.bank ? ` (вход стоил ${fmt((p.entries + p.rebuys + (p.addon ? 1 : 0)) * T.buyin)})` : ''}.</p>` : ''}
        <ol class="pk-tlist">${top.map((x) => `<li${x.id === me ? ' class="me"' : ''}><span>${esc(x.name)}</span><b>${x.prize ? fmt(x.prize) : ''}${x.won ? ` <small>+${fmt(x.won)} баунти</small>` : ''}</b></li>`).join('')}</ol>`
      );
    } else {
      const m = p && !p.out ? this.mOf(T, p.chips) : 0;
      const z = zone(m);
      rows.push(`<div class="pk-tgrid">
        <span>Уровень</span><b>${T.level + 1}: ${fmt(big / 2)}/${fmt(big)}</b>
        <span>Следующий</span><b>${fmt(next / 2)}/${fmt(next)} через ${mmss(left)}</b>
        <span>Осталось</span><b>${alive.length} из ${entries}${T.tables.length > 1 ? ` · столов ${T.tables.length}` : T.mtt ? ' · финальный стол' : ''}</b>
        <span>Средний стек</span><b>${fmt(avg)} (${(avg / big).toFixed(0)} ББ)</b>
        ${p && !p.out ? `<span>Ваш стек</span><b>${fmt(p.chips)} (${(p.chips / big).toFixed(1)} ББ)</b><span>M</span><b><span class="pk-z pk-z-${z.id}">${m.toFixed(1)}</span> — зона ${z.label}: ${z.tip}</b>` : ''}
        ${T.kind === 'pko' && p ? `<span>Ваша голова</span><b>${fmt(p.bounty)} · выбито на ${fmt(p.won)}</b>` : ''}
      </div>`);
      const lead = alive.slice(0, 6);
      const mine = alive.findIndex((x) => x.id === me);
      rows.push(
        `<h4>Лидеры</h4><ol class="pk-tlist">${lead.map((x) => `<li${x.id === me ? ' class="me"' : ''}><span>${esc(x.name)}</span><b>${fmt(x.chips)}${T.kind === 'pko' ? ` <small>🎯${fmt(x.bounty)}</small>` : ''}</b></li>`).join('')}${mine >= lead.length ? `<li class="me" value="${mine + 1}"><span>${esc(alive[mine].name)}</span><b>${fmt(alive[mine].chips)}</b></li>` : ''}</ol>`
      );
    }
    const pz = T.prizes;
    const shown = T.don ? `${T.paid} мест по ${fmt(pz[0])}` : pz.slice(0, 9).map((x, i) => `${i + 1}: ${fmt(x)}`).join(' · ') + (pz.length > 9 ? ` … ${pz.length}: ${fmt(pz[pz.length - 1])}` : '');
    rows.push(`<h4>Призовые</h4><p>Фонд <b>${fmt(T.pool)}</b> очков${T.kind === 'pko' ? ' (и столько же — в баунти)' : ''}, платят ${T.paid} ${T.paid === 1 ? 'место' : T.paid < 5 ? 'места' : 'мест'}.<br><small>${shown}</small></p>`);
    return `<div class="pk-tbox"><div class="pk-thead"><b>${esc(title.trim())}</b><button class="pk-tclose" type="button" aria-label="Закрыть">✕</button></div>${rows.join('')}</div>`;
  }

  /** Имя за местом своего стола: в MTT пересаживают. */
  static seatName(v: View, seat: number): string | null {
    const T = v.tour;
    if (!T) return null;
    const id = T.tables[0].ids[seat];
    // своё место или опустевшее (вылетел) — имя из лобби
    if (id === seat || id == null || id < 0) return null;
    const p = T.players[id];
    return p.human ? p.name : `${p.name} (бот)`;
  }

  destroy() {
    this.bar.remove();
    this.panel.remove();
    this.ask.remove();
    this.rebuyBtn.remove();
  }
}
