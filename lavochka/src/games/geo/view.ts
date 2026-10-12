/* «География» — отрисовка: школьный атлас. Сверху вопрос (название, флаг, герб, столица или контур), ниже — карта или четыре варианта.
 * После вопроса — правильный ответ на карте с кольцом и подписью; кто ошибся — жмёт «Дальше» (или ждёт несколько секунд). */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { armsUrl, ent, type Entity, type Face, flagUrl, frameOf, fullName, KIND_LABEL } from './data';
import { answerOf, type Event, MAP_TRIES, type State, targets, title } from './def';
import { GeoMap, layerOf, loadLayer, outlineSvg } from './map';
import { openRef } from './ref';
import './geo.css';

const BASE = import.meta.env.BASE_URL;

/** Как показать объект: картинка, текст или контур. */
export function face(e: Entity, f: Face, big = false): string {
  switch (f) {
    case 'flag':
      return `<img class="geo-flag${big ? ' big' : ''}" src="${flagUrl(BASE, e.id)}" alt="флаг" draggable="false">`;
    case 'arms':
      return `<img class="geo-arms${big ? ' big' : ''}" src="${armsUrl(BASE, e.id)}" alt="герб" draggable="false">`;
    case 'capital':
      return `<span class="geo-txt">${esc(e.cap ?? '?')}</span>`;
    case 'outline':
      return outlineSvg(e.id, big ? 300 : 200, big ? 200 : 130);
    case 'parent':
      return `<span class="geo-txt">${esc(ent(e.p!)?.n ?? '')}</span>`;
    default:
      return `<span class="geo-txt">${esc(fullName(e))}</span>`;
  }
}

const Q_MAP: Record<string, string> = {
  name: 'Где это?',
  flag: 'Чей это флаг? Найдите на карте',
  arms: 'Чей это герб? Найдите на карте',
  capital: 'Чья это столица? Найдите на карте',
};
const Q_PICK: Record<string, string> = {
  name: 'Что это?',
  flag: 'Какой у него флаг?',
  arms: 'Какой у него герб?',
  capital: 'Какая у него столица?',
  outline: 'Какие у него очертания?',
  parent: 'В какой это стране?',
};
const ASK_LBL: Record<string, string> = { flag: 'Флаг', arms: 'Герб', outline: 'Контур', capital: 'Столица', name: '' };

class GeoView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private head!: HTMLElement;
  private prompt!: HTMLElement;
  private stage!: HTMLElement;
  private foot!: HTMLElement;
  private map = new GeoMap();
  private s: State | null = null;
  private seat: number | null = null;
  /** Номер вопроса, который сейчас нарисован. */
  private drawn = -1;
  private next: (() => void) | null = null;
  private token = 0;
  /** Время на вопрос: обратный отсчёт. */
  private clock: ReturnType<typeof setInterval> | undefined;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="geo-wrap"><div class="geo-atlas">
      <header class="geo-head"><span class="geo-mast">Атлас</span><span class="geo-info"></span><span class="geo-prog"></span></header>
      <div class="geo-prompt"></div>
      <div class="geo-stage"></div>
      <div class="geo-foot"></div>
    </div></div>`);
    root.appendChild(this.root);
    this.head = this.root.querySelector('.geo-info') as HTMLElement;
    this.prompt = this.root.querySelector('.geo-prompt') as HTMLElement;
    this.stage = this.root.querySelector('.geo-stage') as HTMLElement;
    this.foot = this.root.querySelector('.geo-foot') as HTMLElement;
    this.map.onPick = (id) => this.pick(id);
    if (!ctx.demo) {
      const b = h<HTMLButtonElement>(`<button class="btn">📖 Справочник</button>`);
      b.onclick = () => openRef();
      ctx.controls.appendChild(b);
    }
  }

  destroy() {
    this.token++;
    clearInterval(this.clock);
  }

  /** Отсчёт времени на вопрос i; вышло — за свои места этого экрана жмём «Не знаю». */
  private startClock(v: State) {
    clearInterval(this.clock);
    const el = this.root.querySelector('.geo-prog') as HTMLElement;
    if (!v.o.time || this.ctx.demo || v.over) return;
    const i = v.i;
    const end = Date.now() + v.o.time * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      const s = this.s;
      if (!s || s.i !== i || s.over) return clearInterval(this.clock);
      el.textContent = `${i + 1} / ${s.qs.length} · ⏱ ${left}`;
      el.classList.toggle('hurry', left <= 5);
      if (left > 0) return;
      clearInterval(this.clock);
      for (const x of this.ctx.mySeats) if (s.seats.includes(x) && !s.fin[x]) this.ctx.act(x, { type: 'skip' });
    };
    this.clock = setInterval(tick, 250);
    tick();
  }

  private pick(id: string) {
    if (this.seat == null || !this.s || this.s.over) return;
    this.ctx.act(this.seat, { type: 'pick', id });
  }

  setView(v: State) {
    this.s = v;
    void this.render(v);
  }

  private async render(v: State) {
    const tok = ++this.token;
    this.head.textContent = title(v.o);
    if (v.over || !v.o.time) this.root.querySelector('.geo-prog')!.textContent = v.over ? '' : `${v.i + 1} / ${v.qs.length}`;
    if (v.over) return this.summary(v);
    const q = v.qs[v.i];
    const e = ent(q.e);
    const o = v.o;
    // контуры нужны и для карты, и для вопроса «контур»
    const need = new Set([layerOf(e.id)]);
    if (o.mode === 'quiz' && (o.ask === 'outline' || o.pick === 'outline')) for (const id of q.opts ?? []) need.add(layerOf(id));
    if (o.mode === 'map') need.add(frameOf(e, o.set).layer);
    await Promise.all([...need].map(loadLayer).concat(o.mode === 'quiz' ? [loadLayer('detail')] : [])).catch(() => {});
    if (tok !== this.token) return;
    const fresh = this.drawn !== v.i;
    this.drawn = v.i;
    if (fresh) {
      this.startClock(v);
      const lbl = o.mode === 'map' ? Q_MAP[o.ask] : `${ASK_LBL[o.ask] ? ASK_LBL[o.ask] + ' · ' : ''}${Q_PICK[o.pick]}`;
      const big = o.ask === 'flag' || o.ask === 'arms' || o.ask === 'outline';
      this.prompt.className = `geo-prompt${big ? ' pic' : ''}`;
      this.root.classList.toggle('geo-quiz', o.mode === 'quiz');
      this.prompt.innerHTML = `<div class="geo-q">${esc(lbl)}</div><div class="geo-face">${face(e, o.ask, true)}</div>`;
    }
    if (o.mode === 'map') {
      if (!this.stage.contains(this.map.el)) {
        this.stage.innerHTML = '';
        this.stage.appendChild(this.map.el);
      }
      const fr = frameOf(e, o.set);
      await this.map.show(fr.key, new Set(targets(o, e).map((x) => x.id)));
      if (tok !== this.token) return;
      this.map.clearMarks();
      for (const id of this.mine(v)) this.map.mark(id, 'bad');
    } else if (fresh || !this.stage.querySelector('.geo-opts')) {
      const box = h(`<div class="geo-opts${o.pick === 'flag' || o.pick === 'arms' || o.pick === 'outline' ? ' pics' : ''}"></div>`);
      for (const id of q.opts!) {
        const b = h<HTMLButtonElement>(`<button class="geo-opt" data-id="${id}">${face(ent(id), o.pick === 'parent' ? 'name' : o.pick)}</button>`);
        b.onclick = () => this.pick(id);
        box.appendChild(b);
      }
      this.stage.innerHTML = '';
      this.stage.appendChild(box);
    }
    if (o.mode === 'quiz') for (const id of this.mine(v)) this.stage.querySelector(`[data-id="${id}"]`)?.classList.add('bad');
    this.footer(v);
  }

  /** Нажатия места этого экрана в текущем вопросе. */
  private mine(v: State): string[] {
    const seat = this.seat ?? this.ctx.mySeats[0];
    return seat != null ? v.tries[seat] ?? [] : [];
  }

  private footer(v: State) {
    this.foot.innerHTML = '';
    if (this.ctx.demo || v.over) return;
    const seat = this.seat;
    if (seat != null && v.o.mode === 'map') {
      const left = MAP_TRIES - (v.tries[seat]?.length ?? 0);
      this.foot.appendChild(h(`<span class="geo-left">Попыток: ${'●'.repeat(left)}${'○'.repeat(MAP_TRIES - left)}</span>`));
      const skip = h<HTMLButtonElement>(`<button class="btn small">Не знаю</button>`);
      skip.onclick = () => this.ctx.act(seat, { type: 'skip' });
      this.foot.appendChild(skip);
    } else if (seat == null && this.ctx.mySeats.some((x) => v.seats.includes(x)) && v.seats.length > 1) {
      this.foot.appendChild(h(`<span class="geo-left">Ждём остальных…</span>`));
    }
  }

  async play(events: Event[], v: State) {
    const prev = this.s;
    for (const ev of events) {
      if (ev.type === 'try') {
        const mine = this.ctx.mySeats.includes(ev.seat);
        if (mine) ev.ok ? Sound.home() : Sound.nomove();
        if (mine && ev.id) {
          if (prev?.o.mode === 'map') this.map.mark(ev.id, ev.ok ? 'ok' : 'bad');
          else this.stage.querySelector(`[data-id="${ev.id}"]`)?.classList.add(ev.ok ? 'ok' : 'bad');
        }
      }
      if (ev.type === 'reveal' && prev) await this.reveal(prev, ev, v);
      if (ev.type === 'over') Sound.win();
    }
    this.setView(v);
  }

  /** Показать ответ; кто из этого экрана ошибся — тому подольше (или до «Дальше»). */
  private async reveal(prev: State, ev: Extract<Event, { type: 'reveal' }>, v: State) {
    this.token++;
    const e = ent(ev.e);
    const local = this.ctx.mySeats.filter((x) => prev.seats.includes(x));
    const missed = local.some((x) => (v.log[ev.i]?.[x] ?? 0) === 0);
    if (prev.o.mode === 'map') {
      this.map.mark(ev.answer, 'ans');
      this.map.focus(ev.answer);
      this.map.pulse(ev.answer, e.n);
    } else {
      this.stage.querySelector(`[data-id="${ev.answer}"]`)?.classList.add('ans');
    }
    // кто как ответил
    if (prev.seats.length > 1) {
      const row = prev.seats.map((x) => `<span class="geo-who ${v.log[ev.i]?.[x] ? 'ok' : 'bad'}">${this.ctx.name(x)} ${v.log[ev.i]?.[x] ? '+' + v.log[ev.i][x] : '✘'}</span>`).join('');
      this.foot.innerHTML = row;
    } else this.foot.innerHTML = '';
    const info = `${esc(fullName(e))}${e.cap && prev.o.ask !== 'capital' ? ` · столица ${esc(e.cap)}` : ''}${e.k !== 'country' && e.k !== 'region' ? ` · ${KIND_LABEL[e.k]}` : ''}`;
    this.foot.appendChild(h(`<span class="geo-answer">${info}</span>`));
    if (this.ctx.demo) return sleep(1400);
    const wait = missed ? 6000 : 1500;
    if (missed) {
      const b = h<HTMLButtonElement>(`<button class="btn primary small">Дальше</button>`);
      this.foot.appendChild(b);
      await new Promise<void>((res) => {
        const t = setTimeout(res, wait);
        this.next = () => {
          clearTimeout(t);
          res();
        };
        b.onclick = () => this.next?.();
      });
      this.next = null;
    } else await sleep(wait / Math.max(0.5, this.ctx.speed()));
  }

  private summary(v: State) {
    this.root.classList.remove('geo-quiz');
    this.prompt.className = 'geo-prompt';
    this.prompt.innerHTML = `<div class="geo-q">Итог</div>`;
    this.foot.innerHTML = '';
    const seat = this.ctx.mySeats.find((x) => v.seats.includes(x)) ?? v.seats[0];
    const rows = v.qs
      .map((q, k) => {
        const e = ent(q.e);
        const p = v.log[k]?.[seat] ?? 0;
        return `<li class="${p ? 'ok' : 'bad'}">${e.f ? `<img src="${flagUrl(BASE, e.id)}" alt="">` : '<i></i>'}<span>${esc(fullName(e))}${v.o.mode === 'quiz' && v.o.pick === 'parent' ? ` — ${esc(ent(answerOf(v, q)).n)}` : ''}</span><b>${p ? '+' + p : '✘'}</b></li>`;
      })
      .join('');
    this.stage.innerHTML = `<div class="geo-sum"><p>Верно <b>${v.right[seat]}</b> из ${v.qs.length}, очков <b>${v.score[seat]}</b></p><ol>${rows}</ol></div>`;
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.seat = interactive[0] ?? null;
    this.map.enabled = this.seat != null;
    this.root.classList.toggle('geo-locked', this.seat == null);
    if (this.s) this.footer(this.s);
  }

  status(v: State) {
    return v.over ? 'Вопросы кончились' : `Вопрос ${v.i + 1} из ${v.qs.length}`;
  }

  playerStats(v: State, seat: number) {
    return `${v.score[seat] ?? 0} оч. · верно ${v.right[seat] ?? 0}`;
  }
}

export const createView = () => new GeoView();
