/* Партия ботов на карте без показа: прогоны баланса, тесты и Web Worker. Бой — те же боевые боты, что в автобое. */
import { act as battleAct, type BattleSetup, type BattleState, createBattle, currentUnit } from '../sim/battle';
import { type AdvEvent, type World, act, applyBattle, battleSetup, heroById } from '../sim/adv/world';
import { type BotLevel, botAction } from './bot';
import { type BotMem, botStep, newMem } from './advbot';

/** Кто за кого играет в бою на карте: сторона 0 — напавший. Нейтралы и гарнизоны — Средний. */
export function battleLevels(w: World, levels: BotLevel[]): [BotLevel, BotLevel] {
  const b = w.pending!;
  if (b.t !== 'battle') throw new Error('Боя нет');
  const att = heroById(w, b.hero)!;
  const def = b.def.k === 'hero' ? heroById(w, b.def.id)!.owner : -1;
  return [levels[att.owner] ?? 'medium', def >= 0 ? (levels[def] ?? 'medium') : 'medium'];
}

/** Сыграть бой ботов до конца. */
export function fightOut(setup: BattleSetup, levels: [BotLevel, BotLevel]): BattleState {
  const b = createBattle(setup);
  for (let i = 0; i < 20000 && !b.over; i++) battleAct(b, botAction(b, levels[currentUnit(b)!.side]));
  if (!b.over) throw new Error('Бой ботов не кончился');
  return b;
}

const capLevel = (l: BotLevel, cap?: BotLevel): BotLevel => (cap === 'medium' && l === 'hard' ? 'medium' : cap === 'easy' ? 'easy' : l);

/** Ход бота целиком: до «конец хода» или конца партии. Возвращает события. */
export function playBotTurn(w: World, levels: BotLevel[], mem: BotMem = newMem(), opts: { maxActions?: number; battleCap?: BotLevel } = {}): AdvEvent[] {
  const me = w.current;
  const ev: AdvEvent[] = [];
  const max = opts.maxActions ?? 800;
  for (let i = 0; i < max && !w.over && w.current === me; i++) {
    if (w.pending?.t === 'battle') {
      const lv = battleLevels(w, levels);
      ev.push(...applyBattle(w, fightOut(battleSetup(w).setup, [capLevel(lv[0], opts.battleCap), capLevel(lv[1], opts.battleCap)])));
      continue;
    }
    const a = i === max - 1 && !w.pending ? { t: 'end' as const } : botStep(w, levels[me], mem);
    ev.push(...act(w, a));
  }
  if (!w.over && w.current === me && !w.pending) ev.push(...act(w, { t: 'end' }));
  return ev;
}

export interface GameResult {
  winner: number;
  days: number;
}

/** Партия ботов до победы или до `maxDays`. */
export function playBotGame(w: World, levels: BotLevel[], maxDays = 150, battleCap?: BotLevel): GameResult {
  const mems = levels.map(() => newMem());
  while (!w.over && w.day < maxDays) playBotTurn(w, levels, mems[w.current], { battleCap });
  return { winner: w.over ? w.winner : -1, days: w.day + 1 };
}
