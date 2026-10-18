/* Исполнитель сцен: идёт по шагам, копит рассказ, останавливается на вопросах, бросках, боях, лавках и играх. */
import { MAGIC } from './book';
import { sceneByKey } from './content';
import { applyGive, applyTake, die, evalCond, heal, fill, gmNote, hero, leader, living, resolveWho, rollD, rollMain, say, story, sys, type Ctx } from './ctx';
import { qty } from './dice';
import { alive, heroNeed, meleeAttack, missileAttacks, saveNeed, wards, type Hero } from './hero';
import type { Ask, Fight, RollSpec, Scene, Step } from './script';
import { GM, type Frame, type Path, type PendingRoll } from './state';
import { SPELL } from './book';

/** Крючки в другие части движка (без циклических импортов): заполняет engine.ts. */
export const hooks = {
  startFight: (_c: Ctx, _f: Fight, _path: Path, _subj?: number) => {},
  enterRoom: (_c: Ctx, _room: string) => {},
  move: (_c: Ctx, _to: string) => {},
  afterScene: (_c: Ctx) => {},
  startGamble: (_c: Ctx, _path: Path) => {},
};

export function currentScene(c: Ctx): Scene | undefined {
  return c.s.scene ? sceneByKey(c.s.scene.key, c.s.mode, c.s.custom) : undefined;
}

/** Список шагов по пути внутри сцены. */
export function stepsAt(sc: Scene, path: Path): Step[] {
  let x: any = sc;
  for (const p of path) x = x?.[p];
  return Array.isArray(x) ? x : [];
}
export function stepAt(sc: Scene, path: Path): any {
  let x: any = sc;
  for (const p of path) x = x?.[p];
  return x;
}

/** Сыграть кусок сцены с указанного места (отложенные «в первую ночь»). */
export function startSceneAt(c: Ctx, key: string, path: Path, subj?: number): boolean {
  const sc = sceneByKey(key, c.s.mode, c.s.custom);
  if (!sc || !stepsAt(sc, path).length) return false;
  c.s.scene = { key, stack: [{ path, i: 0, ...(subj != null ? { subj } : {}) }], ended: 'repeat' };
  c.s.phase = 'scene';
  run(c);
  return true;
}

export function startScene(c: Ctx, key: string, subj?: number): boolean {
  const sc = sceneByKey(key, c.s.mode, c.s.custom);
  if (!sc) return false;
  c.s.scene = { key, stack: [{ path: ['steps'], i: 0, ...(subj != null ? { subj } : {}) }] };
  c.s.phase = 'scene';
  if (sc.title) story(c, { k: 'title', text: sc.title, ...(sc.img ? { img: sc.img } : {}) });
  if (sc.gm) gmNote(c, sc.gm);
  run(c);
  return true;
}

/** Идти по сцене, пока не понадобится чьё-то решение. */
export function run(c: Ctx): void {
  let guard = 0;
  while (c.s.scene && !c.s.scene.wait && !c.s.result && guard++ < 4000) {
    const sr = c.s.scene;
    const sc = currentScene(c);
    const fr = sr.stack[sr.stack.length - 1];
    if (!sc || !fr) {
      finishScene(c);
      return;
    }
    const steps = stepsAt(sc, fr.path);
    const end = fr.end ?? steps.length;
    if (fr.i >= end) {
      if (fr.each?.length) {
        fr.subj = fr.each.shift();
        fr.i = fr.start ?? 0;
        // павших пропускаем
        const h = fr.subj != null ? hero(c, fr.subj) : undefined;
        if (!h || !alive(h)) fr.i = end;
        continue;
      }
      sr.stack.pop();
      if (!sr.stack.length) {
        finishScene(c);
        return;
      }
      continue;
    }
    const idx = fr.i++;
    exec(c, sc, steps[idx], [...fr.path, idx], fr);
    if (!living(c.s).length && !c.s.result) {
      hooks.afterScene(c);
      return;
    }
  }
}

function push(c: Ctx, path: Path, subj?: number): void {
  c.s.scene!.stack.push({ path, i: 0, ...(subj != null ? { subj } : {}) });
}

/** Развернуть шаг «каждый»: повторить его для каждого живого героя по очереди. */
function expandEach(c: Ctx, fr: Frame, idx: number): void {
  const seats = living(c.s).map((h) => h.seat);
  if (!seats.length) return;
  c.s.scene!.stack.push({ path: fr.path, i: idx, start: idx, end: idx + 1, subj: seats[0], each: seats.slice(1), single: true });
}

function exec(c: Ctx, sc: Scene, step: Step, path: Path, fr: Frame): void {
  const subj = fr.subj;
  const idx = path[path.length - 1] as number;
  if (typeof step === 'string') return say(c, fill(c, step, subj));
  if ('finish' in step) {
    say(c, step.say);
    c.s.result = { win: step.finish === 'win', text: step.say };
    c.s.phase = 'over';
    c.s.scene = null;
    return;
  }
  if ('say' in step && !('give' in step) && !('take' in step) && !('kill' in step)) return say(c, fill(c, step.say, subj), 'img' in step ? step.img : undefined);
  if ('gm' in step && typeof (step as any).gm === 'string' && Object.keys(step).length === 1) return gmNote(c, step.gm);
  if ('ask' in step) return doAsk(c, step, path, fr, idx);
  if ('if' in step) {
    const ok = evalCond(c, step.if, subj);
    if (ok) push(c, [...path, 'then'], subj);
    else if (step.else) push(c, [...path, 'else'], subj);
    return;
  }
  if ('later' in step) {
    (c.s.world.later ??= []).push({ key: c.s.scene!.key, path: [...path, 'do'], ...(subj != null ? { subj } : {}) });
    return;
  }
  if ('each' in step) {
    const seats = living(c.s).map((h) => h.seat);
    if (seats.length) c.s.scene!.stack.push({ path: [...path, 'each'], i: 0, start: 0, subj: seats[0], each: seats.slice(1) });
    return;
  }
  if ('roll' in step) return doRoll(c, step.roll, path, fr, idx);
  if ('fight' in step) return hooks.startFight(c, step, path, subj);
  if ('give' in step) {
    const who = step.who;
    const heroes = resolveWho(c, who, subj, 'party');
    if (step.say) say(c, fill(c, step.say, subj));
    applyGive(c, step.give, heroes, (who ?? (subj != null ? 'subject' : 'party')) === 'party');
    return;
  }
  if ('take' in step) {
    const heroes = resolveWho(c, step.who, subj, 'party');
    if (step.say) say(c, fill(c, step.say, subj));
    applyTake(c, step.take, heroes);
    return;
  }
  if ('set' in step) {
    c.s.world.flags[step.set] = step.v ?? true;
    return;
  }
  if ('random' in step) {
    const n = step.random.length;
    let i: number;
    if (n === 6 || n === 3) i = rollD(c, GM, step.label ?? 'Ведущий бросает кубик', n === 6 ? 'd6' : 'd3').v - 1;
    else i = c.rng.int(n);
    push(c, [...path, 'random', i], subj);
    return;
  }
  if ('shop' in step) {
    c.s.scene!.wait = { k: 'shop', spec: path, done: [] };
    return;
  }
  if ('gamble' in step) return hooks.startGamble(c, path);
  if ('rest' in step) return doRest(c, step.rest.price, step.rest.heal);
  if ('join' in step) {
    const j = step.join;
    if (!c.s.party.allies.some((a) => a.id === j.id)) {
      const hp = qty(j.hp ?? 6, c.rng);
      c.s.party.allies.push({ id: j.id, name: j.name, hp, hpMax: hp, kd: j.kd ?? 7, dmg: j.dmg ?? [1, 2, 3, 4, 5, 6], m: j.m, text: j.text });
      sys(c, `К отряду присоединяется: ${j.name}.`);
    }
    return;
  }
  if ('leave' in step) {
    const a = c.s.party.allies.find((x) => x.id === step.leave);
    if (a) {
      c.s.party.allies = c.s.party.allies.filter((x) => x.id !== step.leave);
      sys(c, `${a.name} покидает отряд.`);
    }
    return;
  }
  if ('open' in step) {
    const w = c.s.where;
    if (w.k === 'site') {
      for (const k of [`${w.site}:${w.room}>${step.open}`, `${w.site}:${step.open}>${w.room}`]) if (!c.s.world.opened.includes(k)) c.s.world.opened.push(k);
      sys(c, 'Открывается проход.');
    }
    return;
  }
  if ('goto' in step) {
    c.s.scene!.then = { goto: step.goto };
    return;
  }
  if ('move' in step) {
    c.s.scene!.then = { move: step.move };
    return;
  }
  if ('node' in step) {
    push(c, ['nodes', step.node], subj);
    return;
  }
  if ('kill' in step) {
    if (step.say) say(c, fill(c, step.say, subj));
    for (const h of resolveWho(c, step.kill, subj, 'subject')) die(c, h);
    return;
  }
  if ('end' in step) {
    c.s.scene!.ended = step.repeat ? 'repeat' : 'done';
    c.s.scene!.stack = [];
    return;
  }
  if ('time' in step) {
    if (step.time === 'night') c.s.world.night = true;
    else if (step.time === 'day') c.s.world.night = false;
    else {
      c.s.world.day += step.time;
      c.s.world.night = false;
      c.s.world.steps = 0;
    }
    return;
  }
  if ('quest' in step) {
    const q = c.s.world.quests.find((x) => x.id === step.quest);
    if (q) {
      if (step.done) q.done = true;
      if (step.text) q.text = step.text;
    } else c.s.world.quests.push({ id: step.quest, text: step.text ?? step.quest, ...(step.done ? { done: true } : {}) });
    sys(c, step.done ? `✔ ${q?.text ?? step.text}` : `Дневник: ${step.text ?? step.quest}`);
    return;
  }
  if ('aggression' in step) {
    const r = rollD(c, GM, 'Агрессивность', 'd6');
    const i = Math.min(r.v, step.aggression.length) - 1;
    push(c, [...path, 'aggression', i], subj);
    return;
  }
}

// ---------- вопросы

function doAsk(c: Ctx, step: Ask, path: Path, fr: Frame, idx: number): void {
  const who = step.who ?? 'leader';
  if (who === 'each' && !fr.single) return expandEach(c, fr, idx);
  const opts = step.opts.map((o, i) => ({ o, i })).filter(({ o }) => !o.if || evalCond(c, o.if, fr.subj));
  if (!opts.length) return;
  let seat: number;
  if (who === 'gm') seat = GM;
  else if ((who === 'each' || who === 'subject') && fr.subj != null) seat = fr.subj;
  else seat = leader(c.s)?.seat ?? GM;
  c.s.scene!.wait = { k: 'ask', who: [seat], prompt: fill(c, step.ask, fr.subj), opts: opts.map(({ o, i }) => ({ i, text: fill(c, o.text, fr.subj) })), answers: {}, each: false, path, subj: fr.subj };
}

/** Ответ на вопрос. */
export function answer(c: Ctx, seat: number, i: number): boolean {
  const w = c.s.scene?.wait;
  if (!w || w.k !== 'ask' || !w.who.includes(seat) || !w.opts.some((o) => o.i === i)) return false;
  const sc = currentScene(c);
  if (!sc) return false;
  const st = stepAt(sc, w.path) as Ask;
  const text = w.opts.find((o) => o.i === i)!.text;
  story(c, { k: 'sys', text: `${seat === GM ? 'Ведущий' : hero(c, seat)?.name ?? ''}: «${text}»` });
  c.s.scene!.wait = undefined;
  c.s.scene!.asks = (c.s.scene!.asks ?? 0) + 1;
  push(c, [...w.path, 'opts', i, 'do'], w.subj ?? (st.who === 'each' || st.who === 'subject' ? seat : undefined));
  run(c);
  return true;
}

// ---------- броски сцены

const SAVE_LABEL: Record<string, string> = {
  paralysis: 'от паралича', poison: 'от яда', petrify: 'от окаменения', fire: 'от огня', acid: 'от кислоты', gas: 'от газа', lightning: 'от молнии', magic: 'от заклинания',
};

/** Спасает ли от этого оберег или стойкость (без броска). */
export function warded(h: Hero, kind: string | undefined, source?: string): string | null {
  if (!kind) return null;
  const w = wards(h);
  const k = kind === 'gas' ? 'acid' : kind;
  if (w.has(k)) return 'волшебная вещь';
  // эльф: противодействие параличу (и гулам) и яду пауков-крабов
  if (h.cls === 'elf' && (kind === 'paralysis' || (kind === 'poison' && source === 'pauk_krab'))) return 'стойкость эльфа';
  return null;
}

function doRoll(c: Ctx, spec: RollSpec, path: Path, fr: Frame, idx: number): void {
  const who = spec.who ?? 'subject';
  if (who === 'each' && !fr.single) return expandEach(c, fr, idx);
  const h = resolveWho(c, who === 'each' ? 'subject' : who, fr.subj, 'subject')[0];
  if (!h) return;
  if (spec.kind === 'stat') {
    const need = spec.need as number;
    const v = h.stats[spec.stat ?? 'str'];
    const ok = v >= need;
    sys(c, `${h.name}: ${spec.label ?? 'проверка'} — ${v} ${ok ? '≥' : '<'} ${need}.`);
    c.s.scene!.lastN = v;
    push(c, [...path, ok ? 'pass' : 'fail'], h.seat);
    return;
  }
  if (spec.kind === 'save') {
    const why = warded(h, spec.save);
    if (why) {
      sys(c, `${h.name} спасён: ${why}.`);
      push(c, [...path, 'pass'], h.seat);
      return;
    }
  }
  // hit: need — КД цели; сколько выбросить — по таблице с поправкой силы (ловкости для метательного) и класса
  let need: number | number[] = spec.kind === 'save' ? saveNeed(h, spec.need as number) : spec.need;
  if (spec.kind === 'hit') {
    const atk = spec.missile ? missileAttacks(h)[0] ?? { ...meleeAttack(h), missile: true } : meleeAttack(h);
    need = heroNeed(h, atk, spec.need as number) ?? 18;
  }
  const roll: PendingRoll = {
    seat: h.seat,
    kind: spec.kind === 'save' ? 'save' : spec.kind === 'hit' ? 'hit' : spec.kind === 'd6' ? 'd6' : spec.kind === 'd3' ? 'd3' : spec.kind === 'dice4' ? 'dice4' : 'main',
    need,
    label: spec.label ?? (spec.kind === 'dice4' ? 'Кости: четыре кубика' : spec.kind === 'save' ? `Бросок удачи ${SAVE_LABEL[spec.save ?? 'magic'] ?? ''}`.trim() : 'Бросок'),
    from: 'scene',
    tries: spec.tries ?? 1,
  };
  c.s.scene!.wait = { k: 'roll', roll, spec: path, left: [h.seat] };
}

/** Герой бросает кубики по просьбе сцены. */
export function sceneRoll(c: Ctx, seat: number): boolean {
  const w = c.s.scene?.wait;
  if (!w || w.k !== 'roll' || w.roll.seat !== seat) return false;
  const r: PendingRoll = w.roll;
  const h = hero(c, seat)!;
  let res: { v: number; ok: boolean };
  if (r.kind === 'd6' || r.kind === 'd3') res = rollD(c, seat, r.label, r.kind, r.need);
  else if (r.kind === 'dice4') {
    let mine = 0;
    let theirs = 0;
    for (let k = 0; k < 10 && mine === theirs; k++) {
      const a = [0, 0, 0, 0].map(() => c.rng.int(6) + 1);
      const b = [0, 0, 0, 0].map(() => c.rng.int(6) + 1);
      mine = a.reduce((x, y) => x + y, 0);
      theirs = b.reduce((x, y) => x + y, 0);
      c.ev.push({ k: 'roll', seat, label: `${h.name}: кости`, dice: a.map((face) => ({ die: 'd6' as const, face })), v: mine });
      c.ev.push({ k: 'roll', seat: GM, label: 'Соперник: кости', dice: b.map((face) => ({ die: 'd6' as const, face })), v: theirs });
    }
    res = { v: mine, ok: mine > theirs };
    r.need = theirs + 1;
  } else res = rollMain(c, seat, r.label, r.need as number);
  c.s.scene!.lastN = res.v;
  const needTxt = Array.isArray(r.need) ? r.need.join(', ') : `${r.need}+`;
  sys(c, `${h.name}: ${r.label.toLowerCase()} — выпало ${res.v} (нужно ${needTxt}) — ${res.ok ? 'удача' : 'неудача'}.`);
  if (!res.ok && (r.tries ?? 1) > 1) {
    r.tries = (r.tries ?? 1) - 1;
    sys(c, `Ещё попытка (осталось ${r.tries}).`);
    return true;
  }
  c.s.scene!.wait = undefined;
  push(c, [...w.spec, res.ok ? 'pass' : 'fail'], seat);
  run(c);
  return true;
}

// ---------- ночлег

export function doRest(c: Ctx, price: number, healAmt?: 'full' | number): void {
  const mode = c.s.opts.rest;
  for (const h of living(c.s)) {
    if (h.gold < price) {
      sys(c, `${h.name}: не хватает денег на ночлег — ночует в конюшне.`);
      continue;
    }
    h.gold -= price;
    if (mode !== 'off' && healAmt != null) {
      const d = heal(h, healAmt);
      if (d > 0) sys(c, `${h.name} отдохнул: +${d} ОР.`);
    }
    if (c.s.opts.spells === 'rest') restoreSpells(h);
  }
  if (price) sys(c, `Ночлег: по ${price} мон. с человека.`);
  c.s.world.day++;
  c.s.world.steps = 0;
  c.s.world.night = false;
}

export function restoreSpells(h: Hero): void {
  for (const sp of h.spells) {
    const d = SPELL[sp.id];
    if (d?.uses != null) sp.left = d.uses;
  }
}

// ---------- конец сцены

export function finishScene(c: Ctx): void {
  const sr = c.s.scene;
  if (!sr) return;
  if (sr.ended !== 'repeat' && !c.s.world.done.includes(sr.key)) c.s.world.done.push(sr.key);
  c.s.scene = null;
  c.s.phase = c.s.result ? 'over' : 'travel';
  const then = sr.then;
  if (then?.goto) hooks.enterRoom(c, then.goto);
  else if (then?.move) hooks.move(c, then.move);
  hooks.afterScene(c);
}

/** Напиток по номеру книги — действие бутылочки на героя. */
export function drinkEffect(c: Ctx, h: Hero, n: number): void {
  const m = MAGIC[n];
  if (!m) return;
  const [k, a, b] = m.fx.split(':');
  say(c, `${h.name} пьёт… ${m.name}! ${m.text}`);
  if (k === 'hp') {
    const v = Number(a);
    if (v > 0) heal(h, v);
    else applyGive(c, { hp: v }, [h], false);
  } else if (k === 'heal') heal(h, 'full');
  else if (k === 'death') die(c, h, 'отравился насмерть');
  else if (k === 'mix') {
    const v = [1.5, 2.5, 3.5][c.rng.int(3)];
    heal(h, v);
    sys(c, `Смеситель: +${v} ОР.`);
  } else if (k === 'stat') applyGive(c, { stat: [a as any, Number(b)] }, [h], false);
  else if (k === 'xp') applyGive(c, { xp: 'level' }, [h], false);
  else if (k === 'invis') {
    if (c.s.combat) c.s.combat.buffs[h.seat] = { ...(c.s.combat.buffs[h.seat] ?? {}), invis: true };
    else h.nextInvis = true;
  }
}
