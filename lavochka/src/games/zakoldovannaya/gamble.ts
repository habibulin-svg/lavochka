/* Игры на деньги из правил: кости (4 кубика, у кого больше), карты (ставки на номера кубика, угадавшему — банк),
 * игра Кора на очки риска. Каждый герой играет за себя, сколько хочет, потом встаёт из-за стола. */
import { die, sys, type Ctx } from './ctx';
import type { Hero } from './hero';
import { alive } from './hero';
import { currentScene, run, stepAt } from './interp';
import type { Path } from './state';

interface Spec {
  game: 'dice' | 'cards' | 'hp';
  vs: string;
  stake?: number;
  gold?: number;
  rounds?: number;
}

export function startGamble(c: Ctx, path: Path): void {
  const spec = stepAt(currentScene(c)!, path).gamble as Spec;
  c.s.scene!.wait = {
    k: 'gamble',
    spec: path,
    game: { game: spec.game, vs: spec.vs, turn: 0, bank: 0, stakes: {}, picks: {}, rounds: spec.rounds ?? 0, oppGold: spec.gold ?? 1000, done: [], net: {} },
  };
  sys(c, `${spec.vs} предлагает сыграть ${spec.game === 'dice' ? 'в кости' : spec.game === 'cards' ? 'в карты' : 'в кости на очки риска'}${spec.stake ? ` (ставка до ${spec.stake})` : ''}.`);
}

const d6 = (c: Ctx) => c.rng.int(6) + 1;

export function gambleAct(c: Ctx, h: Hero, a: { t: string; n?: number; picks?: number[] }): boolean {
  const wt = c.s.scene?.wait;
  if (!wt || wt.k !== 'gamble' || !alive(h)) return false;
  const g = wt.game;
  const spec = stepAt(currentScene(c)!, wt.spec).gamble as Spec & { win?: unknown; lose?: unknown };
  if (g.done!.includes(h.seat)) return false;
  if (a.t === 'gamble-quit') {
    g.done!.push(h.seat);
    if (c.s.heroes.filter(alive).every((x) => g.done!.includes(x.seat))) finish(c, wt.spec, g);
    return true;
  }
  if (a.t !== 'bet') return false;
  const n = Math.floor(Number(a.n));
  const limit = Math.min(spec.stake ?? Infinity, g.oppGold, spec.game === 'hp' ? Math.floor(h.hp) - 0 : h.gold);
  if (!(n >= 1 && n <= limit)) return false;
  if (g.rounds && (g.stakes[h.seat] ?? 0) >= g.rounds) return false;
  g.stakes[h.seat] = (g.stakes[h.seat] ?? 0) + 1;
  let won: boolean;
  if (spec.game === 'cards') {
    const picks = [...new Set((a.picks ?? []).map(Number).filter((x) => x >= 1 && x <= 6))];
    if (!picks.length || picks.length > 5) return false;
    // ставка на каждый номер; остальные номера разбирают соперники, банк — угадавшему
    const f = d6(c);
    c.ev.push({ k: 'roll', seat: 0, label: `Карты: выпало`, dice: [{ die: 'd6', face: f }], v: f });
    won = picks.includes(f);
    const bank = n * 6;
    const delta = won ? bank - n * picks.length : -n * picks.length;
    apply(c, h, delta, spec.game);
    g.oppGold -= delta;
    sys(c, `${h.name} ставит по ${n} на ${picks.join(', ')} — выпало ${f}: ${won ? `банк ${bank}!` : 'мимо'}.`);
  } else {
    const mine = [d6(c), d6(c), d6(c), d6(c)];
    const theirs = [d6(c), d6(c), d6(c), d6(c)];
    const sm = mine.reduce((x, y) => x + y, 0);
    const st = theirs.reduce((x, y) => x + y, 0);
    c.ev.push({ k: 'roll', seat: h.seat, label: `${h.name}: кости`, dice: mine.map((face) => ({ die: 'd6' as const, face })), v: sm });
    c.ev.push({ k: 'roll', seat: 0, label: `${spec.vs}: кости`, dice: theirs.map((face) => ({ die: 'd6' as const, face })), v: st });
    if (sm === st) {
      sys(c, `${h.name}: ${sm} против ${st} — ничья, ставки остаются.`);
      return true;
    }
    won = sm > st;
    apply(c, h, won ? n : -n, spec.game);
    if (spec.game !== 'hp') g.oppGold -= won ? n : -n;
    sys(c, `${h.name}: ${sm} против ${st} — ${won ? 'выигрыш' : 'проигрыш'} ${n} ${spec.game === 'hp' ? 'ОР' : 'мон.'}.`);
  }
  if (g.oppGold <= 0) {
    sys(c, `${spec.vs}: «Всё, я пуст!» — игра окончена.`);
    for (const x of c.s.heroes) if (!g.done!.includes(x.seat)) g.done!.push(x.seat);
    finish(c, wt.spec, g);
  } else if (!alive(h) || (spec.game !== 'hp' && h.gold <= 0)) {
    g.done!.push(h.seat);
    if (c.s.heroes.filter(alive).every((x) => g.done!.includes(x.seat))) finish(c, wt.spec, g);
  }
  return true;
}

function apply(c: Ctx, h: Hero, delta: number, game: string): void {
  const g = (c.s.scene!.wait as { game: { net?: Record<number, number> } }).game;
  g.net![h.seat] = (g.net![h.seat] ?? 0) + delta;
  if (game === 'hp') {
    h.hp += delta;
    if (delta > 0) h.hpMax = Math.max(h.hpMax, h.hp);
    if (h.hp <= 0) die(c, h, 'проиграл последние очки риска');
  } else h.gold = Math.max(0, h.gold + delta);
}

function finish(c: Ctx, path: Path, g: { net?: Record<number, number> }): void {
  const sc = currentScene(c)!;
  const spec = stepAt(sc, path).gamble as { win?: unknown[]; lose?: unknown[] };
  const net = Object.values(g.net ?? {}).reduce((x, y) => x + y, 0);
  c.s.scene!.wait = undefined;
  if (net > 0 && spec.win) c.s.scene!.stack.push({ path: [...path, 'gamble', 'win'], i: 0 });
  else if (net < 0 && spec.lose) c.s.scene!.stack.push({ path: [...path, 'gamble', 'lose'], i: 0 });
  run(c);
}
