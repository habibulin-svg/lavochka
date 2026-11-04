/* Экраны сетевой карты: вход (создать комнату или войти по коду) и лобби — настройки карты у хозяина, места людей и ботов.
 * Сама партия — AdvGame в сетевом режиме. */
import type { BotLevel } from '../bot/bot';
import type { MapClient } from '../net/mapclient';
import type { MapServerMsg } from '../net/mapproto';
import { PLAYER_COLORS } from '../render/mapview';
import { FACTIONS, type Faction } from '../sim/creatures';
import { GUARDS, type GenOptions, type GuardId, MAP_SIZES, type SizeId, WATERS, type WaterId } from '../sim/adv/gen';
import { TEMPLATES } from '../sim/adv/templates';
import type { TownFaction } from '../sim/adv/town';
import { factionClasses, heroName } from '../sim/heroes';
import { button, h } from './common';
import type { Menu } from './menu';

const NAME_KEY = 'geroi-name';
const WHO: [string, string][] = [['', 'Человек'], ['easy', 'Бот: лёгкий'], ['medium', 'Бот: средний'], ['hard', 'Бот: сложный']];

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export class NetMap {
  onCreate: (name: string, gen: GenOptions) => void = () => {};
  onJoin: (name: string, code: string) => void = () => {};
  onLeave: () => void = () => {};

  constructor(private readonly menu: Menu) {}

  home(message?: string): void {
    const col = h('div', 'g-panel g-arena');
    col.append(h('p', 'dim', 'Случайная карта по сети: до четырёх игроков, свободные места займут боты. Ходят по очереди, у каждого свой запас времени; пропал со связи — через минуту за тебя сходит бот.'));
    if (message) col.append(h('p', 'g-warn', message));
    const nameRow = h('label', 'g-field', 'Имя');
    const name = h('input', 'g-input');
    name.maxLength = 24;
    name.value = loadName();
    name.placeholder = 'Пацан';
    nameRow.append(name);
    const who = (): string => {
      const n = name.value.trim() || 'Пацан';
      try {
        localStorage.setItem(NAME_KEY, n);
      } catch {
        /* без памяти */
      }
      return n;
    };
    const code = h('input', 'g-input g-code');
    code.maxLength = 6;
    code.placeholder = 'Код';
    const joinRow = h('div', 'g-row');
    joinRow.append(code, button('Войти по коду', () => code.value.trim() && this.onJoin(who(), code.value.trim().toUpperCase())));
    const gen: GenOptions = { template: 'duel', size: 'm', water: 'lakes', guard: 'normal', seed: (Date.now() % 999999) + 1 };
    col.append(nameRow, button('Создать комнату', () => this.onCreate(who(), gen), 'g-btn main'), joinRow, button('Назад', () => this.menu.title()));
    this.menu.screen(h('h2', 'g-quick-title', 'Карта по сети'), col);
  }

  lobby(c: MapClient, m: Extract<MapServerMsg, { t: 'mlobby' }>): void {
    const box = h('div', 'g-panel g-arena g-netmap');
    box.append(h('p', 'dim', 'Код комнаты — дай его друзьям:'), h('div', 'g-bigcode', c.code));
    const g = m.gen;
    const t = TEMPLATES[g.template];
    if (m.host) {
      const sel = <T extends string>(entries: [T, string][], value: T, on: (v: T) => GenOptions): HTMLSelectElement => {
        const el = h('select', 'g-select');
        for (const [id, name] of entries) el.append(new Option(name, id, false, id === value));
        el.onchange = () => c.gen(on(el.value as T));
        return el;
      };
      const row1 = h('div', 'g-row');
      row1.append(
        sel(Object.values(TEMPLATES).map((x): [string, string] => [x.id, `${x.name} · игроков: ${x.players}`]), g.template, (v) => {
          const nt = TEMPLATES[v];
          return { ...g, template: v, size: nt.sizes.includes(g.size) ? g.size : nt.sizes.includes('m') ? 'm' : nt.sizes[0] };
        }),
        sel(t.sizes.map((x): [SizeId, string] => [x, `${MAP_SIZES[x].name}, ${MAP_SIZES[x].n}×${MAP_SIZES[x].n}`]), g.size, (v) => ({ ...g, size: v })),
      );
      const row2 = h('div', 'g-row');
      row2.append(
        sel(Object.entries(WATERS) as [WaterId, string][], g.water, (v) => ({ ...g, water: v })),
        sel(Object.entries(GUARDS).map(([k, v]): [GuardId, string] => [k as GuardId, v.name]), g.guard, (v) => ({ ...g, guard: v })),
        button('🎲 Другая карта', () => c.gen({ ...g, seed: (Date.now() % 999999) + 1 }), 'g-btn small'),
      );
      box.append(row1, row2);
    } else box.append(h('p', 'g-heroline', `${t.name} · ${MAP_SIZES[g.size].name} · ${WATERS[g.water]} · ${GUARDS[g.guard].name} · сид ${g.seed}`));

    m.seats.forEach((s, i) => {
      const row = h('div', 'g-rand-side');
      row.style.borderLeftColor = `#${PLAYER_COLORS[i].toString(16).padStart(6, '0')}`;
      const mine = i === m.seat;
      row.append(h('b', '', mine ? `${s.name} (ты)` : s.bot ? '—' : s.taken ? s.name : 'Свободно'));
      if (mine) {
        const fac = h('select', 'g-select');
        for (const f of FACTIONS) fac.append(new Option(f.name, f.id, false, f.id === s.faction));
        const hero = h('select', 'g-select');
        const fill = (f: TownFaction): void => {
          hero.replaceChildren();
          for (const cls of factionClasses(f as Faction)) for (let n = 1; n <= 4; n++) {
            const used = m.seats.some((x, j) => j !== i && x.hero.cls === cls.id && x.hero.n === n);
            const opt = new Option(`${heroName({ cls: cls.id, n })}, ${cls.name}`, `${cls.id}:${n}`, false, s.hero.cls === cls.id && s.hero.n === n);
            opt.disabled = used;
            hero.append(opt);
          }
        };
        fill(s.faction);
        fac.onchange = () => {
          const f = fac.value as TownFaction;
          fill(f);
          const first = [...hero.options].find((o) => !o.disabled);
          if (first) hero.value = first.value;
          send();
        };
        const send = (): void => {
          const [cls, n] = hero.value.split(':');
          c.seat(fac.value as TownFaction, { cls, n: Number(n) });
        };
        hero.onchange = send;
        row.append(fac, hero);
      } else {
        row.append(h('span', 'dim', `${FACTIONS.find((f) => f.id === s.faction)!.name}, ${heroName(s.hero)}`));
        if (m.host && i > 0 && !s.taken) {
          const w = h('select', 'g-select g-who');
          for (const [id, label] of WHO) w.append(new Option(label, id, false, id === (s.bot ?? '')));
          w.onchange = () => c.bot(i, (w.value || null) as BotLevel | null);
          row.append(w);
        } else if (s.bot) row.append(h('span', 'dim', WHO.find(([id]) => id === s.bot)![1]));
      }
      box.append(row);
    });
    const ready = m.seats.every((s) => s.bot || s.taken);
    if (m.host) {
      const go = button('Начать', () => c.start(), 'g-btn main');
      go.disabled = !ready;
      box.append(go);
      if (!ready) box.append(h('p', 'dim', 'Ждём игроков — или отдай свободные места ботам.'));
    } else box.append(h('p', 'dim', 'Хозяин начнёт, когда все соберутся.'));
    box.append(button('Выйти', () => this.onLeave()));
    this.menu.screen(h('h2', 'g-quick-title', 'Карта по сети'), box);
  }
}
