/* Меню ГОПС (DOM поверх холста): заглавный экран, списки миссий (кампания по главам, обучение, испытания) со звёздами,
 * брифинг, итог миссии, межигровой ролик. Прогресс — звёзды по миссиям в localStorage (без него игра идёт, просто не помнит). */
import { BRIGADES, brandArt, cutsceneUrl } from '../assets';
import type { NetClient } from '../net/client';
import type { NetSetup } from '../net/protocol';
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

/** Настройка быстрого боя (запоминается между заходами). */
export interface QuickConfig {
  /** human — за этим экраном (в сети — у хозяина), net — сетевой игрок. */
  sides: { brigade: string; who: 'human' | 'net' | 'easy' | 'medium' | 'hard'; count: number }[];
  /** id уровня или 'random'. */
  map: string;
  arsenal: 'full' | 'core';
  hp: number;
  turn: number;
  wind: number;
  sudden: boolean;
  crates: boolean;
}

const QUICK_KEY = 'gops-quick';
const QUICK_DEFAULT: QuickConfig = {
  sides: [{ brigade: 'zatulinka', who: 'human', count: 4 }, { brigade: 'rastochka', who: 'medium', count: 4 }],
  map: 'random', arsenal: 'full', hp: 100, turn: 45, wind: 1, sudden: true, crates: true,
};

export function loadQuick(): QuickConfig {
  try {
    const c = JSON.parse(localStorage.getItem(QUICK_KEY) ?? 'null');
    if (c && Array.isArray(c.sides) && c.sides.length >= 2) return { ...QUICK_DEFAULT, ...c };
  } catch {
    /* без хранилища — по умолчанию */
  }
  return structuredClone(QUICK_DEFAULT);
}

function saveQuick(c: QuickConfig): void {
  try {
    localStorage.setItem(QUICK_KEY, JSON.stringify(c));
  } catch {
    /* не запомним */
  }
}

type Who = QuickConfig['sides'][number]['who'];
const BOTS: [Who, string][] = [['easy', 'Бот: лёгкий'], ['medium', 'Бот: средний'], ['hard', 'Бот: сложный']];
const WHO: [Who, string][] = [['human', 'Человек'], ...BOTS];
const WHO_NET: [Who, string][] = [['net', 'Сетевой игрок'], ['human', 'За моим экраном'], ...BOTS];
const NAME_KEY = 'gops-name';

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || 'Пацан';
  } catch {
    return 'Пацан';
  }
}

/** Выпадающий список: варианты [значение, подпись]. */
function select<T extends string | number>(label: string, value: T, opts: [T, string][], set: (v: T) => void): HTMLElement {
  const wrap = h('label', 'gm-field');
  wrap.append(h('span', '', label));
  const sel = document.createElement('select');
  for (const [v, t] of opts) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = t;
    o.selected = v === value;
    sel.append(o);
  }
  sel.onchange = () => set(opts[sel.selectedIndex][0]);
  wrap.append(sel);
  return wrap;
}

export class Menu {
  readonly el: HTMLElement;
  onPlay: (def: MissionDef) => void = () => {};
  onQuick: (c: QuickConfig) => void = () => {};
  /** Сеть: создать комнату с настройкой / войти по коду. */
  onNetCreate: (c: QuickConfig, name: string) => void = () => {};
  onNetJoin: (code: string, name: string) => void = () => {};

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
      button('Быстрый бой', () => this.quick()),
      button('По сети', () => this.network()),
    );
    this.screen(brandArt('title-keyart-1'), logo, btns, h('div', 'gm-foot', 'Lavochka Games · ранний доступ'));
  }

  /** Быстрый бой: бригады (2–4), кто за них, сколько бойцов, карта и схема. */
  quick(c: QuickConfig = loadQuick(), net = false): void {
    if (net && !c.sides.some((x) => x.who === 'net')) c.sides[1].who = 'net';
    const head = h('div', 'gm-head');
    head.append(button('← Назад', () => (net ? this.network() : this.title())), h('h2', '', net ? 'Новая комната' : 'Быстрый бой'));
    const box = h('div', 'gm-brief gm-quick');
    const sides = h('div', 'gm-sides');
    c.sides.forEach((sd, i) => {
      const row = h('div', 'gm-side');
      const b = BRIGADES.find((x) => x.id === sd.brigade);
      row.style.borderLeftColor = '#' + (b?.color ?? 0xffffff).toString(16).padStart(6, '0');
      row.append(
        select('Бригада', sd.brigade, BRIGADES.map((x) => [x.id, x.name] as [string, string]), (v) => {
          sd.brigade = v;
          this.quick(c, net);
        }),
        select('Кто', sd.who, net ? WHO_NET : WHO, (v) => (sd.who = v)),
        select('Бойцов', sd.count, [1, 2, 3, 4, 5, 6, 8].map((n) => [n, String(n)] as [number, string]), (v) => (sd.count = v)),
      );
      if (c.sides.length > 2) row.append(button('✕', () => {
        c.sides.splice(i, 1);
        this.quick(c, net);
      }, 'small'));
      sides.append(row);
    });
    if (c.sides.length < 4) {
      sides.append(button('+ бригада', () => {
        const free = BRIGADES.find((x) => !c.sides.some((s2) => s2.brigade === x.id))!;
        c.sides.push({ brigade: free.id, who: net ? 'net' : 'medium', count: c.sides[0].count });
        this.quick(c, net);
      }, 'small'));
    }
    const maps: [string, string][] = [['random', 'Случайная'], ...this.missions.map((m) => [m.id, `${m.title} (${m.id})`] as [string, string])];
    const scheme = h('div', 'gm-scheme');
    scheme.append(
      select('Карта', c.map, maps, (v) => (c.map = v)),
      select('Арсенал', c.arsenal, [['full', 'Весь'], ['core', 'Ядро (без экзотики)']], (v) => (c.arsenal = v)),
      select('Здоровье', c.hp, [[50, '50'], [100, '100'], [150, '150'], [200, '200']], (v) => (c.hp = v)),
      select('Ход, с', c.turn, [[20, '20'], [30, '30'], [45, '45'], [60, '60'], [90, '90']], (v) => (c.turn = v)),
      select('Ветер', c.wind, [[0, 'нет'], [0.5, 'слабый'], [1, 'сильный']], (v) => (c.wind = v)),
      select('Внезапная смерть', c.sudden ? 1 : 0, [[1, 'да'], [0, 'нет']], (v) => (c.sudden = v === 1)),
      select('Ящики', c.crates ? 1 : 0, [[1, 'да'], [0, 'нет']], (v) => (c.crates = v === 1)),
    );
    const row = h('div', 'gm-row');
    row.append(button(net ? 'Создать комнату' : 'В бой!', () => {
      saveQuick({ ...c, sides: c.sides.map((x) => ({ ...x, who: x.who === 'net' ? 'medium' : x.who })) });
      if (net) this.onNetCreate(c, loadName());
      else this.onQuick(c);
    }, 'big'));
    box.append(sides, scheme, row);
    this.screen(brandArt('brigade-select-bg-1'), head, box);
  }

  /** По сети: имя, создать комнату, войти по коду. */
  network(error = ''): void {
    const head = h('div', 'gm-head');
    head.append(button('← Назад', () => this.title()), h('h2', '', 'По сети'));
    const box = h('div', 'gm-brief');
    const name = document.createElement('input');
    name.className = 'gm-input';
    name.maxLength = 24;
    name.value = loadName();
    const keepName = () => {
      try {
        localStorage.setItem(NAME_KEY, name.value.trim() || 'Пацан');
      } catch {
        /* не запомним */
      }
    };
    const code = document.createElement('input');
    code.className = 'gm-input code';
    code.maxLength = 6;
    code.placeholder = 'КОД';
    code.oninput = () => (code.value = code.value.toUpperCase());
    const nameRow = h('label', 'gm-field');
    nameRow.append(h('span', '', 'Как тебя звать'), name);
    const joinRow = h('div', 'gm-row');
    joinRow.append(code, button('Войти', () => {
      keepName();
      if (code.value.length >= 4) this.onNetJoin(code.value, name.value.trim() || 'Пацан');
    }, 'big'));
    box.append(nameRow);
    if (error) box.append(h('p', 'gm-error', error));
    box.append(h('h3', 'gm-chapter', 'Позвать пацанов'), h('p', '', 'Выбери бригады и кто за них — получишь код комнаты, скажи его друзьям.'),
      button('Новая комната', () => {
        keepName();
        this.quick(loadQuick(), true);
      }, 'big'), h('h3', 'gm-chapter', 'Зайти к пацанам'), joinRow);
    this.screen(brandArt('menu-bg-2'), head, box);
  }

  /** Лобби сетевой комнаты: код, бригады, кто за ними; гость садится, хозяин начинает. */
  lobby(c: NetClient, leave: () => void): void {
    const setup = c.setup as NetSetup;
    const me = c.peers.find((p) => p.id === c.you);
    const head = h('div', 'gm-head');
    head.append(button('← Выйти', leave), h('h2', '', 'Комната'));
    const box = h('div', 'gm-brief');
    box.append(h('div', 'gm-code', c.code), h('p', 'gm-tip', 'Скажи этот код друзьям: «По сети» → «Зайти к пацанам».'));
    const list = h('div', 'gm-sides');
    let free = 0;
    setup.sides.forEach((sd, i) => {
      const b = BRIGADES.find((x) => x.id === sd.brigade);
      const row = h('div', 'gm-side');
      row.style.borderLeftColor = '#' + (b?.color ?? 0xffffff).toString(16).padStart(6, '0');
      const who = sd.who === 'host' ? `${c.peers.find((p) => p.host)?.name ?? 'хозяин'} (за экраном хозяина)`
        : sd.who === 'net' ? c.peers.find((p) => p.side === i)?.name ?? 'свободно'
        : BOTS.find(([k]) => k === sd.who)?.[1] ?? sd.who;
      row.append(h('b', 'gm-side-name', `${b?.name ?? sd.brigade} ×${sd.count}`), h('span', '', who));
      if (sd.who === 'net' && !c.peers.some((p) => p.side === i)) {
        free++;
        if (!me?.host) row.append(button('Сесть', () => c.send({ t: 'claim', side: i }), 'small'));
      }
      if (sd.who === 'net' && me?.side === i) row.append(button('Встать', () => c.send({ t: 'claim', side: null }), 'small'));
      list.append(row);
    });
    box.append(list, h('p', 'gm-tip', `В комнате: ${c.peers.map((p) => p.name).join(', ')}`));
    const row = h('div', 'gm-row');
    if (me?.host) {
      const go = button(free ? `Ждём игроков: ${free}` : 'Начать!', () => c.send({ t: 'start' }), 'big');
      (go as HTMLButtonElement).disabled = free > 0;
      row.append(go);
    } else row.append(h('span', 'gm-tip', 'Ждём, когда хозяин начнёт…'));
    box.append(row);
    this.screen(brandArt('brigade-select-bg-2'), head, box);
  }

  /** Сообщение поверх (рассинхрон, обрыв): кнопка — в меню. */
  notice(text: string, back: () => void): void {
    const box = h('div', 'gm-brief gm-result');
    box.append(h('h2', 'lose', 'Стоп'), h('p', '', text));
    const row = h('div', 'gm-row');
    row.append(button('В меню', back, 'big'));
    box.append(row);
    this.el.hidden = false;
    this.el.style.background = 'rgba(8, 10, 16, 0.6)';
    this.el.replaceChildren(box);
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
