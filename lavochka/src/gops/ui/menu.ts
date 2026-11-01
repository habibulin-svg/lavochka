/* Меню ГОПС (DOM поверх холста): заглавный экран, списки миссий (кампания по главам, обучение, испытания) со звёздами,
 * брифинг, итог миссии, межигровой ролик. Прогресс — звёзды по миссиям в localStorage (без него игра идёт, просто не помнит). */
import { brandArt, cutsceneUrl } from '../assets';
import type { MissionDef, MissionRun } from '../sim/mission';
import { WEAPON_NAMES } from './hud';
import './menu.css';

export type ListMode = 'mission' | 'training' | 'trial';

const KEY = 'gops-progress';
// docs/gops/LEVELS.md §1
const CHAPTERS = ['', 'Глава 1. Расточка', 'Глава 2. Затон', 'Глава 3. Первомайка', 'Глава 4. Чемской и Ленинский', 'Глава 5. Все районы'];
const STAR_TEXT: Record<string, (v?: number) => string> = {
  win: () => 'пройти',
  no_losses: () => 'без потерь',
  turns_max: (v) => `не дольше ${v} ходов`,
  time_max: (v) => `быстрее ${v} с`,
  hp_percent_min: (v) => `сохранить ${v}% здоровья`,
  shots_max: (v) => `не больше ${v} выстрелов`,
};

export function loadStars(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}').stars ?? {};
  } catch {
    return {};
  }
}

function saveStars(id: string, n: number): void {
  try {
    const stars = loadStars();
    if ((stars[id] ?? 0) >= n) return;
    stars[id] = n;
    localStorage.setItem(KEY, JSON.stringify({ stars }));
  } catch {
    /* без хранилища прогресс не запоминается */
  }
}

const stars = (n: number, of = 3) => '★'.repeat(n) + '☆'.repeat(of - n);

export class Menu {
  readonly el: HTMLElement;
  onPlay: (def: MissionDef) => void = () => {};
  onQuick: () => void = () => {};

  constructor(host: HTMLElement, private missions: MissionDef[]) {
    this.el = document.createElement('div');
    this.el.className = 'gm';
    host.appendChild(this.el);
  }

  hide(): void {
    this.el.hidden = true;
    this.el.replaceChildren();
  }

  private screen(bg: string, ...kids: (HTMLElement | string)[]): void {
    this.el.hidden = false;
    this.el.style.background = `linear-gradient(rgba(8,10,16,.55), rgba(8,10,16,.8)), #0d1018 url("${bg}") center / cover no-repeat`;
    this.el.replaceChildren(...kids.map((k) => (typeof k === 'string' ? h('div', '', k) : k)));
  }

  title(): void {
    const logo = h('div', 'gm-logo');
    logo.append(h('b', '', 'ГОПС'), h('span', '', 'война районов'));
    const btns = h('div', 'gm-col');
    btns.append(
      button('Кампания', () => this.list('mission'), 'big'),
      button('Обучение', () => this.list('training')),
      button('Испытания', () => this.list('trial')),
      button('Быстрый бой', () => this.onQuick()),
    );
    this.screen(brandArt('title-keyart-1'), logo, btns, h('div', 'gm-foot', 'Lavochka Games · ранний доступ'));
  }

  /** Открыта ли миссия: обучение и испытания — все, кампания — по порядку. */
  private open(def: MissionDef, list: MissionDef[], got: Record<string, number>): boolean {
    if (def.mode !== 'mission') return true;
    const i = list.indexOf(def);
    return i === 0 || (got[list[i - 1].id] ?? 0) > 0;
  }

  list(mode: ListMode): void {
    const got = loadStars();
    const list = this.missions.filter((m) => m.mode === mode);
    const head = h('div', 'gm-head');
    head.append(button('← Назад', () => this.title()), h('h2', '', mode === 'mission' ? 'Кампания' : mode === 'training' ? 'Обучение' : 'Испытания'),
      h('span', 'gm-total', `${list.reduce((s, m) => s + (got[m.id] ?? 0), 0)} / ${list.length * 3} ★`));
    const body = h('div', 'gm-list');
    let chapter = -1;
    for (const def of list) {
      if (mode === 'mission' && def.chapter !== chapter) {
        chapter = def.chapter;
        body.append(h('h3', 'gm-chapter', CHAPTERS[chapter] ?? `Глава ${chapter}`));
      }
      const open = this.open(def, list, got);
      const card = h('button', 'gm-card' + (open ? '' : ' locked'));
      card.append(h('i', '', def.id.replace(/^[mtr]0?/, '')), h('span', '', def.title), h('em', '', open ? stars(got[def.id] ?? 0) : '🔒'));
      if (open) card.onclick = () => this.briefing(def);
      else (card as HTMLButtonElement).disabled = true;
      body.append(card);
    }
    this.screen(mode === 'mission' ? brandArt('campaign-map-1') : brandArt('menu-bg-1'), head, body);
  }

  briefing(def: MissionDef): void {
    const box = h('div', 'gm-brief');
    box.append(h('h2', '', def.title), h('p', '', def.briefing));
    if (def.new) box.append(h('p', 'gm-new', `Новое: ${def.new}`));
    const weapons = Object.keys(def.arsenal.weapons).map((id) => WEAPON_NAMES[id] ?? id);
    if (def.arsenal.preset !== 'full' && weapons.length) box.append(h('p', 'gm-arsenal', `Арсенал: ${weapons.join(', ')}`));
    const rules = h('ul', 'gm-stars');
    for (const k of ['1', '2', '3'] as const) {
      const r = def.stars[k];
      rules.append(h('li', '', `${stars(Number(k), Number(k))} — ${STAR_TEXT[r.type]?.(r.value) ?? r.type}`));
    }
    box.append(rules, h('p', 'gm-tip', `Совет: ${def.tip}`));
    const row = h('div', 'gm-row');
    row.append(button('← К списку', () => this.list(def.mode)), button('В бой!', () => this.onPlay(def), 'big'));
    box.append(row);
    this.screen(brandArt(`loading-${Math.max(1, Math.min(4, def.chapter || 1))}-1`), box);
  }

  /** Итог миссии поверх боя. next — следующая миссия списка (если есть и открылась). */
  result(run: MissionRun, got: number, act: { retry: () => void; next: (() => void) | null; menu: () => void }): void {
    const def = run.def;
    if (run.result === 'win') saveStars(def.id, Math.max(1, got));
    const box = h('div', 'gm-brief gm-result');
    box.append(
      h('h2', run.result === 'win' ? 'win' : 'lose', run.result === 'win' ? 'Победа!' : 'Не вышло'),
      h('p', '', run.reason),
    );
    if (run.result === 'win') box.append(h('div', 'gm-big-stars', stars(Math.max(1, got))));
    const row = h('div', 'gm-row');
    row.append(button('Ещё раз', act.retry), button('К списку', act.menu));
    if (act.next && run.result === 'win') row.append(button('Дальше →', act.next, 'big'));
    box.append(row);
    this.el.hidden = false;
    this.el.style.background = 'rgba(8, 10, 16, 0.45)'; // бой видно сквозь итог
    this.el.replaceChildren(box);
  }

  /** Межигровой ролик на весь экран; щелчок или любая клавиша — пропустить. Нет файла — сразу дальше. */
  cutscene(name: string, done: () => void): void {
    const v = document.createElement('video');
    v.className = 'gm-video';
    v.src = cutsceneUrl(name);
    v.autoplay = true;
    v.playsInline = true;
    let over = false;
    const end = () => {
      if (over) return;
      over = true;
      window.removeEventListener('keydown', end);
      v.remove();
      done();
    };
    v.onended = end;
    v.onerror = end;
    v.onclick = end;
    window.addEventListener('keydown', end);
    this.el.hidden = false;
    this.el.style.background = '#000';
    this.el.replaceChildren(v, h('div', 'gm-skip', 'щёлкни — пропустить'));
    void v.play().catch(() => {
      // без жеста браузер может не дать звук — пробуем без звука
      v.muted = true;
      void v.play().catch(end);
    });
  }
}

function h(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, fn: () => void, cls = ''): HTMLElement {
  const b = h('button', 'gm-btn' + (cls ? ` ${cls}` : ''), text);
  b.onclick = fn;
  return b;
}
