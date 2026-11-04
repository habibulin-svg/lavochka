/* Экраны Арены: подбор или комната по коду, лобби, драфт, рейтинг. Бой — обычный Game. */
import type { ArenaClient } from '../net/client';
import { BUDGETS, DEFAULT_BUDGET, type NetServerMsg, type ResultView } from '../net/protocol';
import { CREATURES, FACTIONS } from '../sim/creatures';
import { type DraftCard, isHeroCard } from '../sim/draft';
import { classOf, heroName, heroPortrait } from '../sim/heroes';
import { button, creatureIcon, creatureLines, h } from './common';
import type { Menu } from './menu';

const NAME_KEY = 'geroi-name';

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveName(n: string): void {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* без памяти */
  }
}

export class Arena {
  onQueue: (name: string) => void = () => {};
  onCreate: (name: string, budget: number) => void = () => {};
  onJoin: (name: string, code: string) => void = () => {};
  onCancel: () => void = () => {};
  /** Покидает комнату и закрывает соединение. */
  onLeave: () => void = () => {};
  private timer = 0;

  constructor(private readonly menu: Menu) {}

  stopTimer(): void {
    clearInterval(this.timer);
  }

  private head(title: string): HTMLElement {
    return h('h2', 'g-quick-title', title);
  }

  home(message?: string): void {
    this.stopTimer();
    const col = h('div', 'g-panel g-arena');
    col.append(h('p', 'dim', 'Бой один на один. Герой и армия — драфтом, семь кругов по три карточки, соперник видит твой выбор. Партия на 5–10 минут.'));
    if (message) col.append(h('p', 'g-warn', message));
    const nameRow = h('label', 'g-field', 'Имя');
    const name = h('input', 'g-input');
    name.maxLength = 24;
    name.value = loadName();
    name.placeholder = 'Пацан';
    nameRow.append(name);
    const who = (): string => {
      const n = name.value.trim() || 'Пацан';
      saveName(n);
      return n;
    };
    const code = h('input', 'g-input g-code');
    code.maxLength = 6;
    code.placeholder = 'Код';
    const budget = h('select', 'g-select');
    for (const b of BUDGETS) budget.append(new Option(`${b} семок`, String(b), false, b === DEFAULT_BUDGET));
    const joinRow = h('div', 'g-row');
    joinRow.append(code, button('Войти по коду', () => code.value.trim() && this.onJoin(who(), code.value.trim().toUpperCase())));
    const createRow = h('div', 'g-row');
    createRow.append(budget, button('Комната для друга', () => this.onCreate(who(), Number(budget.value))));
    col.append(nameRow, button('Найти соперника', () => this.onQueue(who()), 'g-btn main'), createRow, joinRow);
    const table = h('div', 'g-top');
    col.append(table, button('Назад', () => this.menu.title()));
    this.menu.screen(this.head('Арена'), col);
    void this.loadTop(table, nameRow);
  }

  private async loadTop(table: HTMLElement, nameRow: HTMLElement): Promise<void> {
    const r = await fetch('/api/geroi/rating', { signal: AbortSignal.timeout(5000) }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!r) return;
    if (r.me) {
      // у вошедшего имя — из аккаунта; рейтинг идёт только ему
      nameRow.replaceWith(h('p', 'g-heroline', `${r.me.name} · рейтинг ${Math.round(r.me.r)} · побед ${r.me.wins}, поражений ${r.me.losses}`));
    } else table.append(h('p', 'dim', 'Рейтинг ведётся у вошедших: подбор соперника, оба вошли на сайт.'));
    if (r.top?.length) {
      table.append(h('b', '', 'Лучшие'));
      r.top.slice(0, 10).forEach((x: { name: string; r: number; wins: number; losses: number }, i: number) => {
        const row = h('div', 'g-toprow');
        row.append(h('span', '', `${i + 1}. ${x.name}`), h('em', '', `${x.r} · ${x.wins}–${x.losses}`));
        table.append(row);
      });
    }
  }

  searching(): void {
    this.stopTimer();
    const box = h('div', 'g-panel g-arena');
    const t0 = Date.now();
    const clock = h('p', 'g-heroline', '0:00');
    this.timer = window.setInterval(() => (clock.textContent = fmt(Date.now() - t0)), 500);
    box.append(h('p', '', 'Ищем соперника…'), clock, h('p', 'dim', 'Никого нет? Создай комнату и дай другу код.'), button('Отмена', () => {
      this.onCancel();
      this.home();
    }));
    this.menu.screen(this.head('Арена'), box);
  }

  lobby(c: ArenaClient, m: Extract<NetServerMsg, { t: 'lobby' }>): void {
    this.stopTimer();
    const box = h('div', 'g-panel g-arena');
    box.append(h('p', 'dim', 'Код комнаты — дай его другу:'), h('div', 'g-bigcode', c.code));
    for (const p of m.peers) box.append(h('p', 'g-heroline', `${p.seat === 0 ? 'Хозяин' : 'Гость'}: ${p.name}`));
    if (m.peers.length < 2) box.append(h('p', 'dim', 'Ждём второго игрока…'));
    if (m.host) {
      const sel = h('select', 'g-select');
      for (const b of BUDGETS) sel.append(new Option(`${b} семок`, String(b), false, b === m.budget));
      sel.onchange = () => c.budget(Number(sel.value));
      const go = button('Начать', () => c.start(), 'g-btn main');
      go.disabled = m.peers.length < 2;
      box.append(sel, go);
    } else box.append(h('p', 'g-heroline', `Бюджет: ${m.budget} семок. Начнёт хозяин.`));
    box.append(button('Выйти', () => this.onLeave()));
    this.menu.screen(this.head('Арена'), box);
  }

  draft(c: ArenaClient, m: Extract<NetServerMsg, { t: 'draft' }>): void {
    this.stopTimer();
    const d = m.d;
    const box = h('div', 'g-draft');
    const title = d.round === 0 ? 'Выбери героя' : `Отряд ${d.round} из ${d.rounds}`;
    const t0 = Date.now();
    const clock = h('b', 'g-draftclock', fmt(d.ms));
    this.timer = window.setInterval(() => (clock.textContent = fmt(Math.max(0, d.ms - (Date.now() - t0)))), 250);
    const top = h('div', 'g-drafthead');
    top.append(h('h2', 'g-quick-title', title), clock);
    const cards = h('div', 'g-cards');
    d.offer.forEach((card, i) => {
      const b = h('button', `g-dcard${d.picked === i ? ' on' : ''}${d.picked >= 0 && d.picked !== i ? ' off' : ''}`);
      b.append(...cardBody(card));
      b.disabled = d.picked >= 0;
      b.onclick = () => c.pick(i);
      cards.append(b);
    });
    if (m.seat === null) cards.append(h('p', 'dim', 'Ты зритель: игроки выбирают.'));
    const sides = h('div', 'g-draftsides');
    d.sides.forEach((s, i) => {
      const col = h('div', `g-panel g-draftside side${i}`);
      const name = m.peers.find((p) => p.seat === i)?.name ?? '';
      col.append(h('b', '', `${name}${m.seat === i ? ' (ты)' : ''}${s.thinking ? ' · думает…' : ' · выбрал'}`));
      if (s.hero) {
        const row = h('div', 'g-draftrow');
        const img = h('img');
        img.src = `/geroi/a/heroes/${heroPortrait(s.hero)}.webp`;
        img.alt = '';
        row.append(img, h('span', '', `${heroName(s.hero)}, ${classOf(s.hero.cls).name}`));
        col.append(row);
      }
      const army = h('div', 'g-draftarmy');
      for (const a of s.army) {
        const it = h('div', 'g-qi');
        it.append(creatureIcon(a.cre, 56), h('span', '', String(a.count)));
        it.title = CREATURES[a.cre].name;
        army.append(it);
      }
      col.append(army);
      sides.append(col);
    });
    box.append(top, cards, sides);
    const leave = button('Сдаться', () => c.resign(), 'g-btn small');
    if (m.seat !== null) box.append(leave);
    this.menu.screen(box);
  }

  /** Партия кончилась до боя: кто-то сдался на драфте. */
  result(r: ResultView, seat: number | null): void {
    this.stopTimer();
    const box = h('div', 'g-panel g-arena');
    box.append(h('h2', 'g-quick-title', seat === r.winner ? 'Победа!' : seat === null ? 'Партия окончена' : 'Поражение'), h('p', 'dim', r.why === 'gone' ? 'Соперник пропал со связи.' : 'Соперник сдался на драфте.'));
    if (seat !== r.winner && seat !== null) box.lastElementChild!.textContent = 'Драфт не доигран.';
    box.append(button('К Арене', () => this.onLeave()));
    this.menu.screen(box);
  }
}

function fmt(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function cardBody(card: DraftCard): Node[] {
  if (isHeroCard(card)) {
    const cls = classOf(card.hero.cls);
    const img = h('img', 'g-dhero');
    img.src = `/geroi/a/heroes/${heroPortrait(card.hero)}.webp`;
    img.alt = '';
    const f = FACTIONS.find((x) => x.id === cls.faction)!;
    return [img, h('b', '', heroName(card.hero)), h('em', '', `${cls.name} · ${f.name}`), h('p', '', `Атака ${cls.atk} · Защита ${cls.def} · Магия ${cls.power} · Знание ${cls.know}`), h('p', 'dim', f.mechanic)];
  }
  const c = CREATURES[card.cre];
  const lines = creatureLines(card.cre).filter((l) => !l.startsWith('Цена'));
  return [creatureIcon(card.cre, 130), h('b', '', `${c.name} × ${card.count}`), h('em', '', c.faction === 'neutral' ? 'нейтралы' : `ступень ${c.tier}${c.up ? ' ★' : ''}`), ...lines.slice(1).map((l) => h('p', '', l))];
}
