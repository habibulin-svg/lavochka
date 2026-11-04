/* Экраны сетевой карты: вход (создать комнату или войти по коду), лобби — настройки карты у хозяина, места людей и ботов, драфт.
 * Сама партия — AdvGame в сетевом режиме. */
import type { BotLevel } from '../bot/bot';
import type { MapClient } from '../net/mapclient';
import { MAP_FACTIONS, type MapServerMsg } from '../net/mapproto';
import { PLAYER_COLORS } from '../render/mapview';
import { FACTIONS, type Faction } from '../sim/creatures';
import { GUARDS, type GenOptions, type GuardId, MAP_SIZES, type SizeId, WATERS, type WaterId } from '../sim/adv/gen';
import { TEMPLATES } from '../sim/adv/templates';
import type { TownFaction } from '../sim/adv/town';
import { type HeroPick, classOf, factionClasses, heroName, heroPortrait } from '../sim/heroes';
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
  onReplay: (file: File) => void = () => {};

  constructor(private readonly menu: Menu) {}

  home(message?: string): void {
    const col = h('div', 'g-panel g-arena');
    col.append(h('p', 'dim', 'Случайная карта по сети: до четырёх игроков, свободные места займут боты. Пока армии далеко, все ходят разом, у каждого свой запас времени; пропал со связи — через минуту за тебя сходит бот. Зашёл в полную комнату — смотришь партию с задержкой в день.'));
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
    const file = h('input');
    file.type = 'file';
    file.accept = '.geroi,application/json';
    file.hidden = true;
    file.onchange = () => file.files?.[0] && this.onReplay(file.files[0]);
    const table = h('div', 'g-top');
    const games = h('div', 'g-top');
    col.append(games);
    void this.loadMail(games, (code) => this.onJoin(who(), code));
    col.append(nameRow, button('Создать комнату', () => this.onCreate(who(), gen), 'g-btn main'), joinRow, button('Смотреть запись партии', () => file.click()), file, table, button('Назад', () => this.menu.title()));
    void this.loadTop(table);
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
      const simul = h('label', 'g-check');
      const box2 = h('input');
      box2.type = 'checkbox';
      box2.checked = m.simul;
      box2.onchange = () => c.simul(box2.checked);
      simul.append(box2, h('span', '', ' Одновременные ходы — пока армии далеко, все ходят разом'));
      const draft = h('label', 'g-check');
      const box3 = h('input');
      box3.type = 'checkbox';
      box3.checked = m.draft;
      box3.onchange = () => c.draftOpt(box3.checked);
      draft.append(box3, h('span', '', ' Драфт — баны и выбор фракций и героев по очереди'));
      box.append(row1, row2, simul, draft);
      const mail = h('label', 'g-check');
      const box5 = h('input');
      box5.type = 'checkbox';
      box5.checked = m.mail;
      box5.onchange = () => c.mail(box5.checked);
      mail.append(box5, h('span', '', ' По переписке — ход до суток, вернуться можно с любого устройства (все входят на сайт)'));
      box.append(mail);
      if (t.players === 2) {
        const ranked = h('label', 'g-check');
        const box4 = h('input');
        box4.type = 'checkbox';
        box4.checked = m.ranked;
        box4.onchange = () => c.ranked(box4.checked);
        ranked.append(box4, h('span', '', ' На рейтинг — дуэль двух людей, оба вошли на сайт'));
        box.append(ranked);
      }
    } else
      box.append(
        h('p', 'g-heroline', `${t.name} · ${MAP_SIZES[g.size].name} · ${WATERS[g.water]} · ${GUARDS[g.guard].name} · сид ${g.seed}${m.simul ? ' · ходы одновременные' : ' · ходы по очереди'}${m.draft ? ' · драфт' : ''}${m.ranked ? ' · на рейтинг' : ''}${m.mail ? ' · по переписке' : ''}`),
      );
    if (m.draft) box.append(h('p', 'dim', 'Фракции и героев выберем драфтом после «Начать».'));

    m.seats.forEach((s, i) => {
      const row = h('div', 'g-rand-side');
      row.style.borderLeftColor = `#${PLAYER_COLORS[i].toString(16).padStart(6, '0')}`;
      const mine = i === m.seat;
      row.append(h('b', '', mine ? `${s.name} (ты)` : s.bot ? '—' : s.taken ? s.name : 'Свободно'));
      if (m.draft) {
        row.append(h('span', 'dim', 'драфт'));
        if (m.host && i > 0 && !s.taken) {
          const w = h('select', 'g-select g-who');
          for (const [id, label] of WHO) w.append(new Option(label, id, false, id === (s.bot ?? '')));
          w.onchange = () => c.bot(i, (w.value || null) as BotLevel | null);
          row.append(w);
        } else if (s.bot) row.append(h('span', 'dim', WHO.find(([id]) => id === s.bot)![1]));
      } else if (mine) {
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
      // союзы: команда места (хозяин выбирает, остальные видят)
      const TEAMS: [string, string][] = [['', 'Сам за себя'], ['1', 'Команда 1'], ['2', 'Команда 2']];
      if (m.host) {
        const tm = h('select', 'g-select g-team');
        for (const [id, label] of TEAMS) tm.append(new Option(label, id, false, id === String(s.team ?? '')));
        tm.onchange = () => c.team(i, tm.value ? Number(tm.value) : null);
        row.append(tm);
      } else if (s.team !== null) row.append(h('span', 'g-teamtag', `Команда ${s.team}`));
      box.append(row);
    });
    const oneTeam = m.seats[0].team !== null && m.seats.every((s) => s.team === m.seats[0].team);
    if (oneTeam) box.append(h('p', 'g-warn', 'Все в одной команде — играть не с кем.'));
    // рейтинг: те же условия, что проверяет сервер (сам с собой — его забота)
    const rankErr = !m.ranked ? null : m.seats.some((s) => s.bot) ? 'На рейтинг — только дуэль двух людей.' : m.seats.some((s) => s.taken && !s.acc) ? 'На рейтинг — оба должны войти на сайт.' : null;
    if (rankErr) box.append(h('p', 'g-warn', rankErr));
    const mailErr = m.mail && m.seats.some((s) => s.taken && !s.acc) ? 'По переписке — все игроки должны войти на сайт.' : null;
    if (mailErr) box.append(h('p', 'g-warn', mailErr));
    const ready = m.seats.every((s) => s.bot || s.taken) && !oneTeam && !rankErr && !mailErr;
    if (m.host) {
      const go = button('Начать', () => c.start(), 'g-btn main');
      go.disabled = !ready;
      box.append(go);
      if (!ready) box.append(h('p', 'dim', 'Ждём игроков — или отдай свободные места ботам.'));
    } else box.append(h('p', 'dim', 'Хозяин начнёт, когда все соберутся.'));
    box.append(button('Выйти', () => this.onLeave()));
    this.menu.screen(h('h2', 'g-quick-title', 'Карта по сети'), box);
  }

  /** Мои партии по переписке: где мой ход — сверху. */
  private async loadMail(box: HTMLElement, open: (code: string) => void): Promise<void> {
    const r = await fetch('/api/geroi/mail', { signal: AbortSignal.timeout(5000) }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const list = (r?.games ?? []) as { code: string; day: number; yours: boolean; left: number; over: boolean; won: boolean; names: string[]; seat: number }[];
    if (!list.length) return;
    box.append(h('b', '', 'Мои партии по переписке'));
    for (const g of list) {
      const row = h('div', 'g-toprow');
      const foes = g.names.filter((_, i) => i !== g.seat).join(', ');
      const state = g.over ? (g.won ? 'победа' : 'кончилась') : g.yours ? `твой ход · ещё ${Math.floor(g.left / 3600_000)} ч` : 'ход соперника';
      const b = button(`${g.code} · день ${g.day} · против ${foes}`, () => open(g.code), `g-btn small${g.yours ? ' on' : ''}`);
      row.append(b, h('em', '', state));
      box.append(row);
    }
  }

  /** Рейтинг дуэлей на карте: свой и лучшие. */
  private async loadTop(table: HTMLElement): Promise<void> {
    const r = await fetch('/api/geroi/rating?map=1', { signal: AbortSignal.timeout(5000) }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!r) return;
    table.append(h('b', '', r.season ? `Рейтинг дуэлей на карте · сезон «${r.season.name}»` : 'Рейтинг дуэлей на карте'));
    if (r.me) table.append(h('p', 'dim', `${r.me.name}: ${Math.round(r.me.r)} · побед ${r.me.wins}, поражений ${r.me.losses}`));
    else table.append(h('p', 'dim', 'Рейтинг ведётся у вошедших: дуэль «на рейтинг», оба вошли на сайт.'));
    r.top?.slice(0, 10).forEach((x: { name: string; r: number; wins: number; losses: number }, i: number) => {
      const row = h('div', 'g-toprow');
      row.append(h('span', '', `${i + 1}. ${x.name}`), h('em', '', `${x.r} · ${x.wins}–${x.losses}`));
      table.append(row);
    });
    const last = r.season?.past?.[0] as { name: string; top: { name: string }[] } | undefined;
    if (last?.top.length) table.append(h('p', 'dim', `Прошлый сезон (${last.name}): ${last.top.map((x, i) => `${i + 1}. ${x.name}`).join(', ')}`));
  }

  /** Фракция, открытая на драфте (между перерисовками). */
  private draftFac: TownFaction | null = null;

  draft(c: MapClient, m: Extract<MapServerMsg, { t: 'mdraft' }>): void {
    const d = m.d;
    const st = d.steps[d.i];
    const mine = st.seat === m.seat;
    const who = m.seats[st.seat].name;
    const box = h('div', 'g-draft');
    const t0 = Date.now();
    const clock = h('b', 'g-draftclock', fmt(d.ms));
    const timer = window.setInterval(() => {
      if (!clock.isConnected) return clearInterval(timer);
      clock.textContent = fmt(Math.max(0, d.ms - (Date.now() - t0)));
    }, 250);
    const top = h('div', 'g-drafthead');
    const task = mine
      ? { hero: 'Забань героя', faction: 'Забань фракцию', pick: 'Выбери фракцию и героя' }[st.kind]
      : `${who} ${{ hero: 'банит героя', faction: 'банит фракцию', pick: 'выбирает' }[st.kind]}`;
    top.append(h('h2', 'g-quick-title', task), clock);

    // порядок шагов
    const order = h('div', 'g-mdorder');
    d.steps.forEach((x, i) => {
      const chip = h('span', `g-mdstep${i === d.i ? ' on' : i < d.i ? ' past' : ''}`, `${x.kind === 'pick' ? 'выбор' : 'бан'}: ${m.seats[x.seat].name}`);
      chip.style.borderColor = color(x.seat);
      order.append(chip);
    });
    box.append(top, order);

    const taken = d.steps.slice(0, d.i).filter((x) => x.kind === 'pick').map((x) => m.seats[x.seat].faction);
    const open = MAP_FACTIONS.filter((f) => !d.factions.includes(f) && (st.kind !== 'pick' || !taken.includes(f)));
    const banned = (p: HeroPick): boolean => d.heroes.some((x) => x.cls === p.cls && x.n === p.n);
    if (mine) {
      if (!this.draftFac || !open.includes(this.draftFac)) this.draftFac = open[0];
      const facs = h('div', 'g-row g-mdfacs');
      for (const f of MAP_FACTIONS) {
        const b = button(
          FACTIONS.find((x) => x.id === f)!.name,
          () => {
            if (st.kind === 'faction') return c.draft(f);
            this.draftFac = f;
            this.draft(c, { ...m, d: { ...d, ms: Math.max(0, d.ms - (Date.now() - t0)) } });
          },
          `g-btn small${st.kind !== 'faction' && f === this.draftFac ? ' on' : ''}`,
        );
        b.disabled = !open.includes(f);
        facs.append(b);
      }
      box.append(facs);
      if (st.kind !== 'faction') {
        const cards = h('div', 'g-mdheroes');
        const f = this.draftFac;
        for (const cls of factionClasses(f as Faction))
          for (let n = 1; n <= 4; n++) {
            const pk = { cls: cls.id, n };
            const b = h('button', 'g-dcard g-mdhero');
            const img = h('img', 'g-dhero');
            img.src = `/geroi/a/heroes/${heroPortrait(pk)}.webp`;
            img.alt = '';
            b.append(img, h('b', '', heroName(pk)), h('em', '', cls.name));
            b.disabled = banned(pk);
            if (b.disabled) b.classList.add('off');
            b.onclick = () => c.draft(f, pk);
            cards.append(b);
          }
        box.append(cards);
      }
    } else box.append(h('p', 'dim', m.seat === null ? 'Ты зритель: игроки выбирают.' : `Ждём: ${who}.`));

    // забаненное и выбранное
    const bans = [...d.factions.map((f) => FACTIONS.find((x) => x.id === f)!.name), ...d.heroes.map((p) => heroName(p))];
    if (bans.length) box.append(h('p', 'g-heroline', `Забанены: ${bans.join(', ')}`));
    const sides = h('div', 'g-draftsides');
    m.seats.forEach((s, i) => {
      const col = h('div', 'g-panel g-draftside');
      col.style.borderTop = `3px solid ${color(i)}`;
      const pick = d.steps.findIndex((x) => x.kind === 'pick' && x.seat === i);
      col.append(h('b', '', `${s.name}${m.seat === i ? ' (ты)' : ''}`));
      if (pick < d.i) {
        const row = h('div', 'g-draftrow');
        const img = h('img');
        img.src = `/geroi/a/heroes/${heroPortrait(s.hero)}.webp`;
        img.alt = '';
        row.append(img, h('span', '', `${FACTIONS.find((x) => x.id === s.faction)!.name}: ${heroName(s.hero)}, ${classOf(s.hero.cls).name}`));
        col.append(row);
      } else col.append(h('span', 'dim', 'ещё не выбрал'));
      sides.append(col);
    });
    box.append(sides, button('Выйти', () => this.onLeave(), 'g-btn small'));
    this.menu.screen(box);
  }
}

function color(seat: number): string {
  return `#${PLAYER_COLORS[seat].toString(16).padStart(6, '0')}`;
}

function fmt(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
