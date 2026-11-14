/* Дворовый спорт — подсказки и «сочность» поверх поля (DOM): лапта, пекарь, чиж.
 *  - Coach: крупная надпись «что делать сейчас» со значками клавиш (на телефоне — подпись кнопки), всплывающие надписи
 *    и очки над полем (pop), указатель на мяч за краем экрана (edge), большая надпись по центру (banner).
 *  - Tutor: первая партия-обучение — короткие шаги «сделай X»; пока шаг не сделан, tutor.holding = true (игра просит
 *    движок подождать — см. hold во вводе лапты). Пропускается кнопкой и запоминается (store `ds.tutor.<игра>`).
 * Подключение: const coach = new Coach(обёртка_поля); coach.say('<b>Твой удар!</b> Потяни вниз и отпусти', ['Пробел']);
 * coach.pop('+2', x, y) — в пикселях холста (yard.toScreen); coach.edge(точка_на_экране, ширина, высота) — каждый кадр. */
import { store } from '../settings';
import { esc, h } from '../util';
import './dvorsport.css';

const touch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** Значок клавиши; на телефоне клавиши не показываем (там кнопки на экране). */
export const kbd = (k: string) => (touch() ? '' : `<kbd class="ds-kbd">${esc(k)}</kbd>`);

export class Coach {
  readonly el: HTMLElement;
  private sayEl: HTMLElement;
  private banEl: HTMLElement;
  private ptr: HTMLElement;
  private banT = 0;
  private last = '';

  constructor(private host: HTMLElement) {
    this.el = h(`<div class="ds-coach"><div class="ds-say"></div></div>`);
    this.sayEl = this.el.querySelector('.ds-say') as HTMLElement;
    this.banEl = h(`<div class="ds-banner"></div>`);
    this.ptr = h(`<div class="ds-edge"><i></i><span>мяч</span></div>`);
    host.append(this.el, this.banEl, this.ptr);
  }

  /** Что делать сейчас: html и клавиши (значки); пусто — спрятать. hot — главное действие (ярче). */
  say(html: string, keys: string[] = [], hot = false) {
    const k = keys.map(kbd).join('');
    const key = `${html}|${k}|${hot}`;
    if (key === this.last) return;
    this.last = key;
    this.sayEl.innerHTML = html ? `${k ? `<span class="ds-keys">${k}</span>` : ''}<span>${html}</span>` : '';
    this.sayEl.classList.toggle('hot', hot);
    this.sayEl.style.display = html ? '' : 'none';
    this.show();
  }

  private show() {
    this.el.style.display = this.last.split('|')[0] || this.roleKey.split('|')[0] ? '' : 'none';
  }

  /** Всплывающая надпись над точкой поля (px холста): «+2», «Поймал с лёта!». */
  pop(text: string, x: number, y: number, cls = '') {
    const p = h(`<div class="ds-pop ${cls}">${esc(text)}</div>`);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    this.host.appendChild(p);
    setTimeout(() => p.remove(), 1800);
  }

  private banUntil = 0;
  private banQ = 0;
  /** Большая надпись по центру на ms. after — не перебивать ту, что уже висит: показать следом. */
  banner(big: string, small = '', ms = 1300, after = false) {
    const now = performance.now();
    clearTimeout(this.banQ);
    if (after && now < this.banUntil) {
      this.banQ = window.setTimeout(() => this.banner(big, small, ms), this.banUntil - now + 60);
      return;
    }
    this.banUntil = now + ms;
    this.banEl.innerHTML = `<b>${esc(big)}</b>${small ? `<span>${esc(small)}</span>` : ''}`;
    this.banEl.classList.add('on');
    clearTimeout(this.banT);
    this.banT = window.setTimeout(() => this.banEl.classList.remove('on'), ms);
  }

  private roleEl: HTMLElement | null = null;
  private roleKey = '';
  /** Кто ты сейчас и зачем — плашка вверху по центру, всегда на виду: «ТЫ БЬЁШЬ · выбей мяч подальше». Сменилась роль —
   * ещё и крупно по центру на пару секунд (announce = false — без этого). Пусто — спрятать. */
  role(title: string, goal = '', color = '#b8401e', announce = true) {
    const key = `${title}|${goal}|${color}`;
    if (key === this.roleKey) return;
    // первую роль партии не объявляем крупно (плашка и так на виду) — только смену
    const prev = this.roleKey.split('|')[0];
    const changed = !!prev && prev !== title;
    this.roleKey = key;
    if (!this.roleEl) {
      this.roleEl = h(`<div class="ds-role"></div>`);
      this.el.prepend(this.roleEl);
    }
    this.roleEl.style.display = title ? '' : 'none';
    this.show();
    if (!title) return;
    this.roleEl.innerHTML = `<b style="background:${color}">${esc(title)}</b>${goal ? `<span>${goal}</span>` : ''}`;
    this.roleEl.classList.remove('new');
    void this.roleEl.offsetWidth;
    this.roleEl.classList.add('new');
    if (changed && announce) this.banner(title, goal.replace(/<[^>]+>/g, ''), 2000, true);
  }

  private flashEl: HTMLElement | null = null;
  /** Вспышка по краям экрана на большом событии: 'good' — зелёная, 'bad' — красная, '' — белая. */
  flash(cls = '') {
    if (!this.flashEl) {
      this.flashEl = h(`<div class="ds-flash"></div>`);
      this.host.appendChild(this.flashEl);
    }
    const f = this.flashEl;
    f.className = `ds-flash ${cls}`;
    void f.offsetWidth;
    f.classList.add('on');
  }

  /** Указатель на точку за краем экрана (p — экранные координаты из toScreen; vis — перед камерой). */
  edge(p: { x: number; y: number; vis: boolean } | null, w: number, hgt: number, label = 'мяч') {
    const m = 26;
    if (!p || (p.vis && p.x > m && p.x < w - m && p.y > m && p.y < hgt - m)) {
      this.ptr.style.display = 'none';
      return;
    }
    // за спиной камеры — отражаем
    let { x, y } = p;
    if (!p.vis) (x = w - x), (y = hgt + 400);
    const cx = w / 2;
    const cy = hgt / 2;
    const dx = x - cx;
    const dy = y - cy;
    const k = Math.min((w / 2 - m) / Math.max(1e-3, Math.abs(dx)), (hgt / 2 - m) / Math.max(1e-3, Math.abs(dy)));
    this.ptr.style.display = 'block';
    this.ptr.style.left = `${cx + dx * k}px`;
    this.ptr.style.top = `${cy + dy * k}px`;
    (this.ptr.firstElementChild as HTMLElement).style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    (this.ptr.lastElementChild as HTMLElement).textContent = label;
  }

  dispose() {
    clearTimeout(this.banQ);
    clearTimeout(this.banT);
    this.el.remove();
    this.banEl.remove();
    this.ptr.remove();
    this.roleEl?.remove();
    this.flashEl?.remove();
  }
}

export interface TutorStep {
  /** Что сделать (html) и какие клавиши показать. */
  text: string;
  keys?: string[];
  /** Сделано? Зовётся каждый кадр (и для шагов, которые сейчас не показаны: сделал раньше — засчитано). */
  done: () => boolean;
  /** Когда шаг к месту (например, «беги» — только в нападении во время розыгрыша); по умолчанию — всегда. */
  when?: () => boolean;
  /** Пока шаг показан и не сделан, игра ждёт (движок стоит). */
  hold?: boolean;
}

/** Обучение в первой партии: показывается первый несделанный шаг, который сейчас к месту; «Пропустить» — и больше
 * не показывать. Шаги можно сделать в любом порядке (игра сама решает, кто бьёт, а кто ловит). */
export class Tutor {
  private ok: boolean[];
  private cur = -1;
  private el: HTMLElement;
  private off = false;

  constructor(
    host: HTMLElement,
    private game: string,
    private steps: TutorStep[],
  ) {
    this.off = Tutor.seen(game);
    this.ok = steps.map(() => false);
    this.el = h(`<div class="ds-tutor"><div class="ds-tutor-n"></div><div class="ds-tutor-t"></div><button>Пропустить обучение</button></div>`);
    (this.el.querySelector('button') as HTMLButtonElement).onclick = () => this.finish();
    host.appendChild(this.el);
    this.draw();
  }

  /** Обучение этой игры уже пройдено/пропущено. */
  static seen(game: string) {
    return store.get<string>(`ds.tutor.${game}`, '') === 'done';
  }

  /** Снова показать обучение (кнопка в настройках игры). */
  static reset(game: string) {
    store.set(`ds.tutor.${game}`, '');
  }

  /** Обучение ещё идёт. */
  get active() {
    return !this.off && this.ok.some((x) => !x);
  }

  /** Показан шаг (подсказку игры прячем, чтобы не мешала). */
  get showing() {
    return this.active && this.cur >= 0;
  }

  /** Игра должна ждать: показан шаг, который просит паузу. */
  get holding() {
    return this.showing && !!this.steps[this.cur].hold;
  }

  /** Каждый кадр: отметить сделанное, выбрать, что показать. */
  tick() {
    if (!this.active) return;
    this.steps.forEach((st, i) => {
      if (!this.ok[i] && st.done()) this.ok[i] = true;
    });
    if (!this.ok.some((x) => !x)) return this.finish();
    const next = this.steps.findIndex((st, i) => !this.ok[i] && (st.when?.() ?? true));
    if (next !== this.cur) {
      this.cur = next;
      this.draw();
    }
  }

  private draw() {
    const on = this.showing;
    this.el.style.display = on ? '' : 'none';
    if (!on) return;
    const st = this.steps[this.cur];
    (this.el.querySelector('.ds-tutor-n') as HTMLElement).textContent = `Обучение · осталось ${this.ok.filter((x) => !x).length} из ${this.steps.length}`;
    (this.el.querySelector('.ds-tutor-t') as HTMLElement).innerHTML = `${(st.keys ?? []).map(kbd).join('')} ${st.text}`;
  }

  finish() {
    this.off = true;
    this.cur = -1;
    store.set(`ds.tutor.${this.game}`, 'done');
    this.draw();
  }

  dispose() {
    this.el.remove();
  }
}
