/* Миссии ГОПС (docs/gops/levels/missions.json): сборка мира по миссии, проверка цели после каждого кадра, звёзды.
 * Без DOM и случайности снаружи — предметы раскладываются от сида миссии (Rng), как и весь sim. */
import { dealSpawns } from '../level';
import { toPx } from './fx';
import type { Mask } from './mask';
import { Rng } from './rng';
import { ARSENAL_AMMO } from './weapons';
import { GRAVITY } from './body';
import { type Obj, type ObjKind, type Scheme, type World, TICK_HZ, addMine, createWorld, dropCrate, wormById } from './world';

export type Objective =
  | { type: 'eliminate' }
  | { type: 'survive_turns'; turns: number }
  | { type: 'one_turn_kill'; turns: number }
  | { type: 'collect_crates'; count: number }
  | { type: 'reach_point'; points?: [number, number][]; ordered?: boolean; position?: [number, number]; label?: string }
  | { type: 'race_time'; checkpoints: number; time_limit?: number }
  | { type: 'targets'; count: number; kind: string; turns?: number; time_limit?: number }
  | { type: 'destroy_objects'; object: string; count: number }
  | { type: 'protect'; ward: string; ward_hp: number; turns: number }
  | { type: 'king_of_hill'; zone: [number, number, number]; hold_turns: number }
  | { type: 'rescue'; count: number; where: string };

export interface StarRule {
  type: 'win' | 'no_losses' | 'turns_max' | 'time_max' | 'hp_percent_min' | 'shots_max';
  value?: number;
}

export interface MissionDef {
  id: string;
  title: string;
  mode: 'training' | 'mission' | 'trial';
  chapter: number;
  theme: string;
  time: string;
  briefing: string;
  tip: string;
  new?: string | null;
  music: string;
  cutscene_after: string | null;
  difficulty: number;
  player: { count: number; hp: number };
  enemies: { brigade: string; count: number; hp: number; bot: 'easy' | 'medium' | 'hard'; clustered?: boolean; boss?: boolean; name?: string }[];
  arsenal: { preset: string; weapons: Record<string, number>; delays: Record<string, number> };
  scheme: {
    turn_time: number; round_time: number; wind: number | 'none'; fall_damage: number; crates: number; barrels: number; mines: number;
    sudden_death: 'water' | 'none'; rising_water?: number; gravity?: number; no_walk?: boolean; rope_only?: boolean; forts?: boolean;
  };
  objective: Objective;
  stars: Record<'1' | '2' | '3', StarRule>;
  terrain: { archetype: string; seed: number; water: number; props: number };
  medals_seconds?: { bronze: number; silver: number; gold: number };
  boss?: boolean;
}

/** Ход миссии: счётчики для цели и звёзд. Бригада игрока — всегда 0. */
export interface MissionRun {
  def: MissionDef;
  result: 'win' | 'lose' | null;
  /** Почему кончилось (для итога). */
  reason: string;
  ticks: number;
  shots: number;
  collected: number;
  hold: number;
  startHp: number;
  /** Ход какой бригады шёл последним и сколько своих ходов игрок уже начал. */
  lastTeam: number;
  seenTurns: number;
}

export interface LevelGeom {
  mask: Mask;
  waterY: number;
  spawns: [number, number][];
  race?: { start: [number, number]; finish: [number, number] };
}

/** Схема миссии → схема мира. */
export function missionScheme(def: MissionDef): Scheme {
  const s = def.scheme;
  const rising = s.rising_water ?? 0;
  return {
    turnTime: s.turn_time,
    retreat: 3,
    wind: s.wind === 'none' ? 0 : s.wind,
    fallDamage: Math.round(s.fall_damage * 100),
    // поднимающаяся вода в испытаниях — с первого хода
    roundTime: rising ? 0 : s.round_time,
    riseStep: rising ? Math.round(rising * 24) : s.sudden_death === 'water' ? 24 : 0,
    crates: Math.round(s.crates * 100),
    gravity: s.gravity ? Math.round(GRAVITY * s.gravity) : undefined,
    noWalk: s.no_walk || undefined,
  };
}

/** Арсенал игрока (enemy = false) или противника: у противника всегда есть базовое, чтобы было чем воевать. */
export function missionAmmo(def: MissionDef, enemy: boolean): Record<string, number> {
  if (def.arsenal.preset === 'full') return { ...ARSENAL_AMMO };
  const base: Record<string, number> = enemy ? { mukha: -1, limonka: -1, sling: -1, makarov: -1, tychok: -1 } : {};
  return { ...base, ...def.arsenal.weapons, kuryu: -1, pas: -1 };
}

const WARD_LOOK: Record<string, string> = { babka: 'бабку', beehive: 'улей', locomotive: 'тепловоз', kiosk: 'ларёк' };
const EXPLOSIVE = ['barrel', 'boiler', 'transformer', 'gas'];

/** Мир по миссии: бригады, схема, задержки оружия, предметы цели, бочки и мины схемы, ящики «собери». */
export function buildMission(def: MissionDef, lv: LevelGeom, seed: number): { world: World; run: MissionRun } {
  const teams = [{ count: def.player.count, hp: def.player.hp }, ...def.enemies.map((e) => ({ count: e.count, hp: e.hp }))];
  const dealt = dealSpawns(lv.spawns, teams.length, Math.max(...teams.map((t) => t.count)));
  if (lv.race && def.objective.type === 'race_time') dealt[0] = [lv.race.start];
  const world = createWorld({
    mask: lv.mask, waterY: lv.waterY, seed, scheme: missionScheme(def),
    teams: teams.map((t, i) => ({ spawns: dealt[i].slice(0, t.count), hp: t.hp, ammo: missionAmmo(def, i > 0) })),
  });
  world.delays = { ...def.arsenal.delays };
  const rng = new Rng((def.terrain.seed ^ 0x5eed) >>> 0);
  const W = lv.mask.w, H = lv.mask.h;
  const start = dealt[0][0];
  const used: [number, number][] = world.worms.map((x) => [toPx(x.x), toPx(x.y)]);
  let id = 1;
  const add = (kind: ObjKind, look: string, x: number, y: number, r: number, hp: number, swing = 0): Obj => {
    const o: Obj = { id: id++, kind, look, x, y, r, hp, alive: true, explosive: EXPLOSIVE.includes(look), bx: x, swing };
    world.objs.push(o);
    used.push([x, y]);
    return o;
  };
  /** Место на поверхности над жидкостью, подальше от бойцов и других предметов. */
  const spot = (r: number, minD = 70): [number, number] | null => {
    for (let t = 0; t < 60; t++) {
      const x = 50 + rng.below(W - 100);
      const sy = lv.mask.surfaceBelow(x, 0);
      if (sy < 0 || sy > lv.waterY - 16) continue;
      const y = sy - r - 1;
      if (used.every(([ux, uy]) => Math.abs(ux - x) + Math.abs(uy - y) > minD)) return [x, y];
    }
    return null;
  };
  const near = (fx: number, fy: number, r: number): [number, number] => {
    const x = Math.max(20, Math.min(W - 20, Math.round(fx * W)));
    let sy = lv.mask.surfaceBelow(x, Math.max(0, Math.round(fy * H) - 60));
    if (sy < 0) sy = lv.mask.surfaceBelow(x, 0);
    return [x, (sy < 0 ? Math.round(fy * H) : sy) - r - 1];
  };
  const o = def.objective;
  if (o.type === 'reach_point') for (const [fx, fy] of o.points ?? [o.position!]) add('flag', 'flag', ...near(fx, fy, 8), 8, -1);
  if (o.type === 'race_time') {
    // контрольные точки — по точкам высадки уровня, от старта по удалению; последняя — финиш
    const pts = lv.spawns.filter(([x, y]) => x !== start[0] || y !== start[1]);
    pts.sort((a, b) => Math.abs(a[0] - start[0]) - Math.abs(b[0] - start[0]));
    const n = Math.max(1, o.checkpoints - (lv.race ? 1 : 0));
    for (const [x, y] of pts.slice(0, n)) add('flag', 'flag', x, y - 10, 8, -1);
    if (lv.race) add('flag', 'finish', lv.race.finish[0], lv.race.finish[1] - 10, 8, -1);
  }
  if (o.type === 'targets') {
    const look = o.kind === 'cans_fence' ? 'can' : o.kind === 'barrels_behind_wall' ? 'keg' : 'plate';
    for (let i = 0; i < o.count; i++) {
      const p = spot(6, 50);
      if (p) add('target', look, p[0], p[1] - (look === 'plate' ? 6 : 0), 6, 1, o.kind === 'moving' ? 30 : 0);
    }
  }
  if (o.type === 'destroy_objects') {
    for (let i = 0; i < o.count; i++) {
      const p = spot(10);
      if (p) add('target', o.object, p[0], p[1], 10, 30);
    }
  }
  if (o.type === 'protect') {
    const x = Math.max(30, Math.min(W - 30, start[0] + (start[0] < W / 2 ? 50 : -50)));
    add('ward', o.ward, ...near(x / W, start[1] / H, 14), 14, o.ward_hp);
  }
  if (o.type === 'rescue') {
    const far = lv.spawns.slice().sort((a, b) => Math.abs(b[0] - start[0]) - Math.abs(a[0] - start[0]));
    for (const [x, y] of far.slice(0, o.count)) add('hostage', 'hostage', x, y - 9, 9, 60);
  }
  if (o.type === 'collect_crates') {
    for (let i = 0; i < o.count; i++) {
      const p = spot(8, 40);
      if (p) dropCrate(world, i % 3 === 2 ? 'health' : 'weapon', undefined, p[0]);
    }
  }
  for (let i = 0; i < Math.round(def.scheme.barrels * 8); i++) {
    const p = spot(8, 60);
    if (p) add('barrel', 'barrel', p[0], p[1], 8, 20);
  }
  for (let i = 0; i < def.scheme.mines; i++) {
    const p = spot(3, 60);
    if (p) addMine(world, p[0], p[1]);
  }
  const run: MissionRun = {
    def, result: null, reason: '', ticks: 0, shots: 0, collected: 0, hold: 0,
    startHp: def.player.count * def.player.hp, lastTeam: -1, seenTurns: 0,
  };
  return { world, run };
}

const playerWorms = (w: World) => w.teams[0].worms.map((id) => wormById(w, id)!);
const standing = (w: World, team: number) => w.teams[team].worms.some((id) => wormById(w, id)!.state !== 'dead');

/** Проверка цели после кадра мира (события кадра — в w.events). */
export function tickMission(w: World, run: MissionRun): void {
  if (run.result) return;
  run.ticks++;
  const o = run.def.objective;
  let turnOver = false;
  for (const e of w.events) {
    if (e.t === 'fire' && wormById(w, e.worm)?.team === 0) run.shots++;
    if (e.t === 'crate' && wormById(w, e.worm)?.team === 0) run.collected++;
    if (e.t === 'turn') {
      // кончился ход игрока: начался ход другой бригады или (в одиночку) следующий свой
      const t0 = w.teams[0].turns;
      if (run.lastTeam === 0 && (e.team !== 0 || t0 > run.seenTurns)) turnOver = true;
      run.lastTeam = e.team;
      run.seenTurns = t0;
    }
  }
  if (w.phase === 'over' && w.winner !== 0 && !standing(w, 0)) turnOver = true;
  const finish = (result: 'win' | 'lose', reason: string) => {
    run.result = result;
    run.reason = reason;
  };
  const enemies = w.teams.length > 1;
  const enemiesDead = enemies && w.teams.slice(1).every((t) => !standing(w, t.id));
  const turns = w.teams[0].turns;
  const left = (kind: ObjKind) => w.objs.filter((x) => x.kind === kind && x.alive);
  const active = wormById(w, w.active);
  const mine = active && active.team === 0 && active.state !== 'dead' ? active : undefined;

  switch (o.type) {
    case 'eliminate':
      if (enemiesDead) finish('win', 'Район наш');
      break;
    case 'survive_turns':
      if (enemiesDead) finish('win', 'Выстояли и всех выбили');
      else if (turnOver && turns >= o.turns) finish('win', 'Выстояли');
      break;
    case 'one_turn_kill':
      if (enemiesDead) finish('win', 'Всех за один заход');
      else if (turnOver && turns >= o.turns) finish('lose', 'Не уложились в ход');
      break;
    case 'collect_crates':
      if (run.collected >= o.count) finish('win', 'Все ящики наши');
      break;
    case 'reach_point':
    case 'race_time': {
      const flags = left('flag');
      const next = flags[0];
      if (mine && next && Math.abs(toPx(mine.x) - next.x) + Math.abs(toPx(mine.y) - next.y) < 22) {
        next.alive = false;
        w.events.push({ t: 'obj', id: next.id, kind: 'flag' });
      }
      if (!left('flag').length) finish('win', o.type === 'race_time' ? 'Финиш!' : 'Дошли');
      else if (o.type === 'race_time' && o.time_limit && run.ticks > o.time_limit * TICK_HZ) finish('lose', 'Не уложились во время');
      break;
    }
    case 'targets':
      if (!left('target').length) finish('win', 'Все мишени сбиты');
      else if (o.turns && turnOver && turns >= o.turns) finish('lose', 'Мишени остались');
      else if (o.time_limit && run.ticks > o.time_limit * TICK_HZ) finish('lose', 'Не уложились во время');
      break;
    case 'destroy_objects':
      if (!left('target').length) finish('win', 'Всё разнесли');
      break;
    case 'protect':
      if (!left('ward').length) finish('lose', `Не уберегли ${WARD_LOOK[o.ward] ?? 'подопечного'}`);
      else if (enemiesDead || (turnOver && turns >= o.turns)) finish('win', 'Уберегли');
      break;
    case 'king_of_hill': {
      if (enemiesDead) {
        finish('win', 'Пятачок наш');
        break;
      }
      if (turnOver) {
        const [cx, cy, cr] = zonePx(w, o.zone);
        const inZone = (team: number) =>
          w.worms.some((x) => x.state !== 'dead' && (team === 0 ? x.team === 0 : x.team !== 0) && dist2(toPx(x.x) - cx, toPx(x.y) - cy) <= cr * cr);
        run.hold = inZone(0) && !inZone(1) ? run.hold + 1 : 0;
        if (run.hold >= o.hold_turns) finish('win', 'Пятачок наш');
      }
      break;
    }
    case 'rescue': {
      for (const h of left('hostage')) {
        if (h.hp <= 0) continue;
        if (playerWorms(w).some((x) => x.state !== 'dead' && Math.abs(toPx(x.x) - h.x) + Math.abs(toPx(x.y) - h.y) < 26)) {
          h.alive = false;
          w.events.push({ t: 'obj', id: h.id, kind: 'hostage' });
        }
      }
      if (w.objs.some((x) => x.kind === 'hostage' && x.hp <= 0)) finish('lose', 'Своего не уберегли');
      else if (!left('hostage').length) finish('win', 'Свои спасены');
      break;
    }
  }
  if (!run.result && !standing(w, 0)) finish('lose', 'Бригада сдулась');
  if (!run.result && w.phase === 'over') finish(w.winner === 0 ? 'win' : 'lose', w.winner === 0 ? 'Район наш' : 'Бригада сдулась');
}

const dist2 = (dx: number, dy: number) => dx * dx + dy * dy;

/** Зона «царя горы» в px: центр и радиус (доли карты). */
export function zonePx(w: World, z: [number, number, number]): [number, number, number] {
  return [Math.round(z[0] * w.mask.w), Math.round(z[1] * w.mask.h), Math.round(z[2] * w.mask.w)];
}

/** Звёзды за пройденную миссию (0 — не пройдена). */
export function missionStars(w: World, run: MissionRun): number {
  if (run.result !== 'win') return 0;
  const hp = playerWorms(w).reduce((s, x) => s + (x.state === 'dead' ? 0 : Math.max(0, x.hp)), 0);
  const ok = (r: StarRule): boolean => {
    switch (r.type) {
      case 'win': return true;
      case 'no_losses': return playerWorms(w).every((x) => x.state !== 'dead' && x.hp > 0);
      case 'turns_max': return w.teams[0].turns <= (r.value ?? 0);
      case 'time_max': return run.ticks <= (r.value ?? 0) * TICK_HZ;
      case 'hp_percent_min': return hp * 100 >= (r.value ?? 0) * run.startHp;
      case 'shots_max': return run.shots <= (r.value ?? 0);
    }
  };
  return (['1', '2', '3'] as const).filter((k) => ok(run.def.stars[k])).length;
}

/** Строка цели для интерфейса: что сделать и сколько осталось. */
export function objectiveText(w: World, run: MissionRun): string {
  const o = run.def.objective;
  const n = (kind: ObjKind) => w.objs.filter((x) => x.kind === kind).length;
  const done = (kind: ObjKind) => w.objs.filter((x) => x.kind === kind && !x.alive).length;
  const turn = Math.max(1, w.teams[0].turns);
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  switch (o.type) {
    case 'eliminate': return 'Выбей всех';
    case 'survive_turns': return `Продержись: ход ${Math.min(turn, o.turns)} из ${o.turns}`;
    case 'one_turn_kill': return `Всех за ${o.turns === 1 ? 'один ход' : `${o.turns} хода`}`;
    case 'collect_crates': return `Ящики: ${run.collected} из ${o.count}`;
    case 'reach_point': return o.label ? `Доберись: ${o.label}` : `Флажки: ${done('flag')} из ${n('flag')}`;
    case 'race_time': return `Точки: ${done('flag')} из ${n('flag')} · ${clock(run.ticks / TICK_HZ)}${o.time_limit ? ` / ${clock(o.time_limit)}` : ''}`;
    case 'targets': return `Мишени: ${done('target')} из ${n('target')}${o.turns ? ` · ход ${Math.min(turn, o.turns)} из ${o.turns}` : ''}${o.time_limit ? ` · ${clock(run.ticks / TICK_HZ)} / ${clock(o.time_limit)}` : ''}`;
    case 'destroy_objects': return `Разнеси: ${done('target')} из ${n('target')}`;
    case 'protect': {
      const ward = w.objs.find((x) => x.kind === 'ward');
      return `Береги ${WARD_LOOK[o.ward] ?? 'своего'} (${ward ? Math.max(0, ward.hp) : 0}) · ход ${Math.min(turn, o.turns)} из ${o.turns}`;
    }
    case 'king_of_hill': return `Держи пятачок: ${run.hold} из ${o.hold_turns} ходов`;
    case 'rescue': return `Спаси своих: ${done('hostage')} из ${n('hostage')}`;
  }
}
