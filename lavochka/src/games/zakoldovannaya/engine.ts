/* Движок «Заколдованной страны»: действия, очередь, видимость, применение. */
import type { ApplyResult, Options, Rng, SeatSpec } from '../../core/types';
import { CLASSES, SPELL, type ClassId } from './book';
import * as cb from './combat';
import { CAMPAIGNS, ROAD, sceneByKey } from './content';
import { addXp, applyGive, evalCond, hero, leader, living, say, story, sys, type Ctx, type Ev } from './ctx';
import { allowed, alive, meleeAttack, missileAttacks, newHero, type Hero } from './hero';
import * as ha from './heroact';
import { answer, currentScene, hooks, run, sceneRoll, startScene, stepAt } from './interp';
import { MONSTER } from './monsters';
import type { Foe, Give } from './script';
import { GM, type State } from './state';
import * as w from './world';
import { startGamble, gambleAct } from './gamble';

export type Action =
  // оформление героя
  | { t: 'cr-roll' }
  | { t: 'cr-class'; cls: ClassId }
  | { t: 'cr-bonus' }
  | { t: 'cr-hp' }
  | { t: 'cr-money' }
  | { t: 'cr-done' }
  | { t: 'cr-spell'; id: string }
  | { t: 'cr-name'; name: string; portrait?: string }
  // лавка и вещи
  | { t: 'buy'; id: string; n?: number }
  | { t: 'sell'; id: string; bottle?: number }
  | { t: 'shop-done' }
  | { t: 'exchange'; n: number }
  | { t: 'equip'; id: string }
  | { t: 'unequip'; slot: 'armor' | 'shield' | 'helm' | 'melee' | 'launcher' }
  | { t: 'drink'; bottle: number }
  | { t: 'give'; to: number; gold?: number; id?: string; bottle?: number }
  | { t: 'cast'; id: string; target?: number; bottle?: number }
  | { t: 'lvl-hp' }
  | { t: 'lvl-spell'; id: string }
  // дорога и замки (вожак)
  | { t: 'go'; path: number[] }
  | { t: 'enter' }
  | { t: 'room'; id: string }
  | { t: 'search'; spell?: boolean }
  | { t: 'leave' }
  | { t: 'camp' }
  | { t: 'lead'; seat: number }
  // сцена
  | { t: 'answer'; i: number }
  | { t: 'roll' }
  // бой
  | { t: 'init'; spell?: boolean }
  | { t: 'attack'; target: number }
  | { t: 'shoot'; i: number; target: number }
  | { t: 'flee' }
  /** Следующий бросок начатого удара: урон или ещё стрела. */
  | { t: 'strike' }
  | { t: 'turn' }
  | { t: 'repel'; id: 'holy_water' | 'aconite' }
  | { t: 'stake'; target: number }
  | { t: 'pass' }
  | { t: 'save' }
  // игры на деньги
  | { t: 'bet'; n: number; picks?: number[] }
  | { t: 'gamble-quit' }
  // ведущий
  | { t: 'gm-init' }
  | { t: 'gm-foes'; targets?: Record<number, number> }
  | { t: 'gm-say'; text: string }
  | { t: 'gm-fight'; foes: Foe[] }
  | { t: 'gm-give'; seat: number; give: Give }
  | { t: 'gm-event' };

// ---------- крючки интерпретатора

hooks.startFight = (c, f, path, subj) => cb.startFight(c, f, path, subj);
hooks.enterRoom = (c, room) => w.enterRoom(c, room);
hooks.move = (c, to) => w.moveTo(c, to);
hooks.startGamble = (c, path) => startGamble(c, path);
hooks.afterScene = (c) => afterScene(c);
w.setCondHook((c, cond) => evalCond(c, cond));

/** После сцены: утро после ночной встречи, выход из места без плана, гибель отряда. */
function afterScene(c: Ctx): void {
  const s = c.s;
  if (s.result) return;
  if (!living(s).length) {
    s.result = { win: false, text: 'Отряд погиб. Заколдованная страна осталась во власти тёмных сил.' };
    s.phase = 'over';
    s.scene = null;
    s.combat = null;
    return;
  }
  if (s.scene) return;
  const sr = (c as Ctx & { lastMorning?: boolean }).lastMorning;
  void sr;
  if (s.world.night && s.where.k === 'map') w.morning(c);
  if (s.where.k === 'site' && !w.planOf(s, s.where.site)) s.where = { k: 'map', node: s.where.node };
  // сюжет кампании: флаг взведён сценой
  if (!s.scene && !s.result) w.fireTriggers(c, { on: 'flag' });
}

// ---------- партия

export interface ModeDef {
  id: string;
  title: string;
}

export function setup(seats: SeatSpec[], opts: Options, rng: Rng): State {
  const mode = String(opts.mode ?? 'book');
  const heroes: Hero[] = seats.filter((s) => s.seat !== GM).map((s) => newHero(s.seat, s.name));
  const camp = CAMPAIGNS[mode];
  const slots = camp?.layout ?? (opts.layout === 'shuffle' ? w.shuffledLayout(rng) : w.bookLayout());
  const roadMode = camp?.road ?? 'book';
  const deck: string[] = [];
  if (roadMode !== 'own') deck.push(...ROAD.map((r) => r.id));
  if (roadMode !== 'book' && camp?.roadScenes) deck.push(...camp.roadScenes.map((id) => `camp:${mode}:${id}`));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const s: State = {
    mode,
    opts: {
      layout: opts.layout === 'shuffle' ? 'shuffle' : 'book',
      rest: (['off', 'inn', 'always'] as const).find((x) => x === opts.rest) ?? 'inn',
      spells: opts.spells === 'never' ? 'never' : 'rest',
      death: opts.death === 'dead' ? 'dead' : 'forpost',
      stats: !!opts.stats,
      road: Number(opts.road ?? 35),
    },
    phase: 'create',
    heroes,
    party: { leader: heroes[0]?.seat ?? 1, allies: [] },
    world: { slots, visited: [], done: [], opened: [], flags: {}, deck, seen: [w.MAP.start], day: 1, steps: 0, night: false, quests: [] },
    where: { k: 'map', node: w.MAP.start },
    scene: null,
    combat: null,
    story: [],
    seq: 0,
    result: null,
  };
  // быстрый старт: готовые герои
  if (opts.quick) for (const h of heroes) quickHero(h, rng);
  if (opts.quick) startJourney({ s, rng, ev: [] });
  return s;
}

/** Готовый герой: бросок по правилам, класс по качествам, покупки как у бота. */
function quickHero(h: Hero, rng: Rng): void {
  const c: Ctx = { s: { heroes: [h], story: [], world: { day: 1 }, seq: 0 } as unknown as State, rng, ev: [] };
  let guard = 0;
  while (h.create.step !== 'done' && guard++ < 60) {
    const a = autoCreate(h);
    if (!a) break;
    applyCreate(c, h, a);
  }
}

function startJourney(c: Ctx): void {
  const s = c.s;
  s.phase = 'travel';
  const camp = CAMPAIGNS[s.mode];
  story(c, { k: 'title', text: camp?.title ?? 'Заколдованная страна' });
  if (camp) {
    // пролог кампании — как сцена
    s.custom = camp.intro;
    startScene(c, 'custom');
  } else {
    say(c, 'Отряд собрался в Форпосте — последней крепости на краю Заколдованной страны. Дальше — леса, полные чудовищ, заколдованные города и замки злых колдунов. Говорят, всем этим краем правит Чёрный маг. Пройти всю охрану и освободить страну из-под власти тёмных сил — вот ваша задача.');
    w.enterSite(c);
  }
}

// ---------- кто ходит

export function toAct(s: State): number[] {
  if (s.result) return [];
  if (s.phase === 'create') return s.heroes.filter((h) => h.create.step !== 'done').map((h) => h.seat);
  if (s.combat) return s.combat.queue.filter((x) => x === GM || alive(s.heroes.find((h) => h.seat === x)!));
  const wt = s.scene?.wait;
  if (s.scene && wt) {
    if (wt.k === 'ask') return wt.who;
    if (wt.k === 'roll') return [wt.roll.seat];
    if (wt.k === 'shop') return living(s).filter((h) => !wt.done.includes(h.seat)).map((h) => h.seat);
    if (wt.k === 'gamble') return living(s).filter((h) => !wt.game.done?.includes(h.seat)).map((h) => h.seat);
    return [];
  }
  const out: number[] = [];
  const l = leader(s);
  if (l) out.push(l.seat);
  for (const h of living(s)) if (h.pending.length && !out.includes(h.seat)) out.push(h.seat);
  return out;
}

/** Действия вне очереди: вещи, бутылочки, заклинания вне боя, рассказ ведущего. */
export function free(s: State, seat: number, a: Action): boolean {
  if (s.result || !a || typeof a !== 'object') return false;
  if (seat === GM) return a.t === 'gm-say' || a.t === 'gm-give' || ((a.t === 'gm-fight' || a.t === 'gm-event') && !s.scene && !s.combat && s.phase === 'travel');
  if (s.phase === 'create' || s.combat) return false;
  return ['equip', 'unequip', 'drink', 'give', 'cast', 'lvl-hp', 'lvl-spell'].includes(a.t);
}

// ---------- применение

export function apply(s0: State, seat: number, a: Action, rng: Rng): ApplyResult<State, Ev> | null {
  if (!a || typeof a !== 'object') return null;
  const s: State = structuredClone(s0);
  const c: Ctx = { s, rng, ev: [] };
  const ok = act(c, seat, a);
  if (!ok) return null;
  return { state: s, events: c.ev };
}

function act(c: Ctx, seat: number, a: Action): boolean {
  const s = c.s;
  const h = hero(c, seat);

  // ведущий
  if (seat === GM) {
    switch (a.t) {
      case 'gm-say': {
        const text = String(a.text ?? '').trim().slice(0, 600);
        if (!text) return false;
        story(c, { k: 'talk', text });
        return true;
      }
      case 'gm-give': {
        const t = hero(c, a.seat);
        if (!t || !alive(t)) return false;
        applyGive(c, a.give, [t], false);
        return true;
      }
      case 'gm-fight': {
        const foes = (a.foes ?? []).filter((f) => MONSTER[f.m]).slice(0, 12);
        if (!foes.length || s.scene || s.combat) return false;
        s.custom = [{ fight: foes, win: [{ say: 'Опасность повержена.' }] }];
        return startScene(c, 'custom');
      }
      case 'gm-event': {
        if (s.scene || s.combat || s.where.k !== 'map') return false;
        return w.roadEncounter(c, { bridge: false, node: s.where.node, night: s.world.night }, true);
      }
      case 'gm-init':
        return cb.rollInit(c, GM);
      case 'gm-foes':
        return cb.foesAct(c, a.targets);
      case 'answer':
        return answer(c, GM, a.i);
      default:
        return false;
    }
  }
  if (!h) return false;

  // оформление
  if (s.phase === 'create') {
    if (!applyCreate(c, h, a)) return false;
    if (s.heroes.every((x) => x.create.step === 'done')) startJourney(c);
    return true;
  }

  // свободные действия
  switch (a.t) {
    case 'equip':
      return ha.equip(h, a.id);
    case 'unequip':
      return ha.unequip(h, a.slot);
    case 'drink':
      if (s.combat) {
        if (!cb.canAct(c, seat) || cb.striking(c, seat) || !ha.drink(c, h, a.bottle)) return false;
        cb.heroDone(c, seat);
        return true;
      }
      return ha.drink(c, h, a.bottle);
    case 'give': {
      const t = hero(c, a.to);
      return !!t && ha.giveTo(c, h, t, a.gold, a.id, a.bottle);
    }
    case 'lvl-hp':
      return ha.levelHp(c, h);
    case 'lvl-spell':
      return ha.levelSpell(c, h, a.id);
    case 'cast':
      if (s.combat) {
        if (!cb.canAct(c, seat) || cb.striking(c, seat)) return false;
        if (s.combat.phase === 'init') return SPELL[a.id]?.kind === 'initiative' && cb.rollInit(c, seat, true);
        if (!cb.castInCombat(c, h, a.id, a.target)) return false;
        cb.heroDone(c, seat);
        return true;
      }
      return ha.castOutside(c, h, a.id, a.target, a.bottle);
  }

  // бой
  const cm = s.combat;
  if (cm) {
    if (!cb.canAct(c, seat)) return false;
    // удар начат — сначала его броски (урон, следующая стрела)
    if (cb.striking(c, seat) && a.t !== 'strike') return false;
    switch (a.t) {
      case 'init':
        return cm.phase === 'init' && cb.rollInit(c, seat, a.spell);
      case 'save':
        return cm.phase === 'saves' && cb.combatSave(c, seat);
      case 'attack':
        if (cm.phase !== 'party' || !cb.heroAttack(c, h, meleeAttack(h), a.target)) return false;
        if (!cb.striking(c, seat)) cb.heroDone(c, seat);
        return true;
      case 'shoot': {
        if (cm.phase !== 'party' && cm.phase !== 'volley') return false;
        const atk = missileAttacks(h)[a.i];
        if (!atk || !cb.heroAttack(c, h, atk, a.target)) return false;
        if (!cb.striking(c, seat)) cb.heroDone(c, seat);
        return true;
      }
      case 'strike':
        if (!cb.strikeNext(c, h)) return false;
        if (!cb.striking(c, seat)) cb.heroDone(c, seat);
        return true;
      case 'flee':
        if (cm.phase !== 'party' || !cb.tryFlee(c, h)) return false;
        cb.heroDone(c, seat);
        return true;
      case 'turn':
        if (cm.phase !== 'party' || !cb.tryTurn(c, h)) return false;
        cb.heroDone(c, seat);
        return true;
      case 'repel':
        if (cm.phase !== 'party' || !cb.useRepel(c, h, a.id)) return false;
        cb.heroDone(c, seat);
        return true;
      case 'stake':
        if (cm.phase !== 'party' || !cb.useStake(c, h, a.target)) return false;
        cb.heroDone(c, seat);
        return true;
      case 'pass':
        if (cm.phase !== 'party' && cm.phase !== 'volley') return false;
        cb.heroDone(c, seat);
        return true;
      default:
        return false;
    }
  }

  // сцена ждёт
  const wt = s.scene?.wait;
  if (s.scene && wt) {
    if (wt.k === 'ask' && a.t === 'answer') return answer(c, seat, a.i);
    if (wt.k === 'roll' && a.t === 'roll') return sceneRoll(c, seat);
    if (wt.k === 'shop') {
      const spec = stepAt(currentScene(c)!, wt.spec).shop as { kind?: string; markup?: number; free?: boolean; stock?: { id: string; price: number }[]; exchange?: boolean };
      const list = ha.wares(spec.kind ?? 'trurl', spec.free ? 0 : spec.markup ?? 1, spec.stock);
      if (a.t === 'buy') return ha.buy(c, h, list, a.id, a.n ?? 1);
      if (a.t === 'sell') return spec.kind !== 'custom' && ha.sell(c, h, a.id, a.bottle);
      if (a.t === 'exchange') return !!spec.exchange && ha.exchange(c, h, a.n);
      if (a.t === 'shop-done') {
        if (wt.done.includes(seat)) return false;
        wt.done.push(seat);
        if (living(s).every((x) => wt.done.includes(x.seat))) {
          s.scene.wait = undefined;
          run(c);
        }
        return true;
      }
      return false;
    }
    if (wt.k === 'gamble') return gambleAct(c, h, a);
    return false;
  }

  // дорога и замки — вожак
  if (leader(s)?.seat !== seat) return false;
  switch (a.t) {
    case 'go':
      return Array.isArray(a.path) && a.path.length <= 40 && w.travel(c, a.path.map(Number));
    case 'enter':
      return w.enterSite(c);
    case 'room':
      return w.goRoom(c, String(a.id));
    case 'search':
      return w.search(c, seat, !!a.spell);
    case 'leave':
      return w.leaveSite(c);
    case 'camp':
      if (s.where.k !== 'map') return false;
      w.nightfall(c);
      return true;
    case 'lead': {
      const t = hero(c, a.seat);
      if (!t || !alive(t)) return false;
      s.party.leader = t.seat;
      sys(c, `Вожак отряда — ${t.name}.`);
      return true;
    }
  }
  return false;
}

export function applyCreate(c: Ctx, h: Hero, a: Action): boolean {
  switch (a.t) {
    case 'cr-roll':
      return ha.crRoll(c, h);
    case 'cr-class':
      return ha.crClass(c, h, a.cls);
    case 'cr-bonus':
      return ha.crBonus(c, h);
    case 'cr-hp':
      return ha.crHp(c, h);
    case 'cr-money':
      return ha.crMoney(c, h);
    case 'buy':
      return h.create.step === 'shop' && ha.buy(c, h, ha.wares('start'), a.id, a.n ?? 1);
    case 'sell':
      return h.create.step === 'shop' && ha.sell(c, h, a.id);
    case 'equip':
      return ha.equip(h, a.id);
    case 'unequip':
      return ha.unequip(h, a.slot);
    case 'cr-done':
      return ha.crShopDone(c, h);
    case 'cr-spell':
      return ha.crSpell(c, h, a.id);
    case 'cr-name':
      return ha.crName(c, h, String(a.name ?? ''), a.portrait);
    default:
      return false;
  }
}

/** Ход оформления, который сделал бы бот (и «быстрый старт»). */
export function autoCreate(h: Hero): Action | null {
  switch (h.create.step) {
    case 'stats':
      return { t: 'cr-roll' };
    case 'class': {
      const el = (Object.keys(CLASSES) as ClassId[]).filter((k) => CLASSES[k].main.every((st) => h.stats[st] >= 9));
      if (!el.length) return { t: 'cr-roll' };
      const score = (k: ClassId) => CLASSES[k].main.reduce((a, st) => a + h.stats[st], 0) / CLASSES[k].main.length + (k === 'voin' ? 1 : 0);
      return { t: 'cr-class', cls: el.sort((x, y) => score(y) - score(x))[0] };
    }
    case 'bonus':
      return { t: 'cr-bonus' };
    case 'hp':
      return { t: 'cr-hp' };
    case 'money':
      return { t: 'cr-money' };
    case 'shop': {
      const buy = shoppingList(h);
      return buy ? { t: 'buy', id: buy } : { t: 'cr-done' };
    }
    case 'spell':
      return { t: 'cr-spell', id: 'tma' };
    case 'name':
      return { t: 'cr-name', name: h.name };
    default:
      return null;
  }
}

/** Что купить на оставшиеся деньги: лучшее оружие, доспех, щит, мешок. */
export function shoppingList(h: Hero): string | null {
  if (!h.cls) return null;
  const list = ha.wares('start');
  const afford = (id: string) => {
    const x = list.find((v) => v.id === id);
    return !!x && ha.priceFor(h, x) <= h.gold && allowed(h.cls!, id);
  };
  const has = (id: string) => h.items.some((x) => x.id === id);
  if (!h.eq.melee) {
    for (const id of ['sword_long', 'sword1', 'axe', 'dagger_gold', 'spear', 'dagger']) if (afford(id) && !(h.cls === 'mag' && id === 'dagger_gold' && !afford(id))) return id;
  }
  if (!h.eq.armor) for (const id of ['kolch_silver', 'kolch_iron', 'kozha_silver', 'kozha']) if (afford(id) && h.gold - (ha.wares('start').find((x) => x.id === id)!.price) >= 10) return id;
  if (!h.eq.shield && afford('shield') && !h.eq.melee?.includes('2') && h.gold >= 25) return 'shield';
  if (!has('sack') && afford('sack')) return 'sack';
  if (!h.eq.launcher && afford('bow_short') && h.gold >= 40) return 'bow_short';
  if (h.eq.launcher === 'bow_short' && !h.items.some((x) => x.id === 'arrow_short' && x.n >= 10) && afford('arrow_short')) return 'arrow_short';
  return null;
}

// ---------- видимость

/** Что видят места: ведущий — всё; герои — без заметок книги, чисел карточек (если не разрешено), колоды и флагов. */
export function view(s: State, seats: number[] | 'all') {
  const gm = seats === 'all' || seats.includes(GM);
  const sc = s.scene ? sceneByKey(s.scene.key, s.mode, s.custom) : undefined;
  const wt = s.scene?.wait;
  const sceneOpts =
    wt?.k === 'ask'
      ? wt.opts.map((o) => {
          const st = stepAt(sc!, wt.path)?.opts?.[o.i];
          return { ...o, bot: st?.bot, risky: st?.risky };
        })
      : undefined;
  const showStats = gm || s.opts.stats;
  const foes = (s.combat?.foes ?? []).map((f) => ({
    uid: f.uid, m: f.m, name: f.name, dead: !!f.dead, fled: !!f.fled || !!f.gone, blind: !!f.blind, weak: !!f.weak,
    hp: showStats ? f.hp : undefined, hpMax: showStats ? f.hpMax : undefined, kd: showStats ? f.kd : undefined,
    hurt: f.hp >= f.hpMax ? 0 : f.hp > f.hpMax / 2 ? 1 : f.hp > f.hpMax / 4 ? 2 : 3,
    value: showStats ? f.value : undefined, morale: showStats ? f.morale : undefined,
  }));
  const here = s.where.k === 'site' ? w.exits(s, s.where.site, s.where.room).filter((e) => gm || !e.hidden) : [];
  return {
    gm,
    mode: s.mode,
    opts: s.opts,
    phase: s.phase,
    heroes: s.heroes,
    party: s.party,
    where: s.where,
    exits: here,
    world: {
      slots: s.world.slots, visited: s.world.visited, done: s.world.done, opened: s.world.opened, seen: s.world.seen,
      day: s.world.day, steps: s.world.steps, night: s.world.night, quests: s.world.quests, deck: s.world.deck.length,
      flags: gm ? s.world.flags : Object.fromEntries(Object.entries(s.world.flags).filter(([k]) => k.endsWith(':search') || k.startsWith('left:'))),
    },
    scene: s.scene ? { key: s.scene.key, asks: s.scene.asks ?? 0, title: sc?.title, gmText: gm ? sc?.gm : undefined, wait: wt ? { ...wt, opts: sceneOpts } : undefined, shop: wt?.k === 'shop' ? stepAt(sc!, wt.spec).shop : undefined } : null,
    combat: s.combat ? { ...s.combat, foes } : null,
    story: gm ? s.story : s.story.filter((e) => !e.gmOnly),
    result: s.result,
  };
}
export type View = ReturnType<typeof view>;

export { addXp };
