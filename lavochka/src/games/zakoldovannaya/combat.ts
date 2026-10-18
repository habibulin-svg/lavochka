/* Бой по правилам «Заколдованной страны».
 * Залп метательным (без жребия) → жребий первенства (d6 отряда против d6 ведущего) → стороны бьют по очереди до конца боя.
 * Герой попадает основным броском (d3 → 0/6/12, + d6) по КД цели; опасности бьют так же по КД героя. Особые атаки
 * (паралич, яд, окаменение, дух дракона, смерть) — повторный бросок ведущего «N и более», затем БУ героя.
 * Мораль: потеряла половину ОР (или убита половина равнозначных) — бросок морали, «ам» не бегут. */
import { CLASSES, SPELL, invisKd, needToHit } from './book';
import { addXp, die, giveGoldParty, hero, hurt, leader, living, rollD, rollMain, say, story, sys, type Ctx } from './ctx';
import { fmtHp, mainRoll, pick } from './dice';
import { alive, heroKd, heroNeed, meleeAttack, missileAttacks, removeItem, saveNeed, wards, type Attack, type Hero } from './hero';
import { hooks, run, warded } from './interp';
import { MONSTER, special, spawn } from './monsters';
import type { Fight } from './script';
import { GM, type Ally, type Combat, type FoeInst, type Path, type PendingRoll } from './state';

export const STONE = new Set(['kamennaya_statuya', 'kamennyy_piton', 'kamennyy_drakon', 'zheleznaya_statuya']);
export const WERE = new Set(['chelovek_volk', 'chelovek_vepr', 'chelovek_medved', 'chelovek_tigr', 'volkolak']);
export const ANIMALS = new Set(['lev', 'medved_grizli', 'chernyy_medved', 'sablezubiy_tigr', 'gigantskaya_pchela', 'strig', 'kran', 'volkolak', 'ston', 'letayushchaya_mu', 'morskoy_zmey', 'edinorog']);
const UNDEAD = new Set(['gul', 'zombi', 'nekrofag', 'skelet', 'spektr', 'cherep', 'vulin']);

export const activeFoes = (cb: Combat) => cb.foes.filter((f) => !f.dead && !f.fled && !f.gone);
export const fighting = (c: Ctx) => living(c.s).filter((h) => !c.s.combat?.fled.includes(h.seat) && !c.s.combat?.bound.includes(h.seat));

function foeKd(f: FoeInst): number {
  return f.kd + (f.weak ? 2 : 0);
}

// ---------- начало

export function startFight(c: Ctx, f: Fight, path: Path, _subj?: number): void {
  const uid0 = 1;
  const foes = spawn(typeof f.fight === 'string' ? [{ m: f.fight }] : f.fight, c.rng, uid0);
  if (!foes.length) return;
  const cb: Combat = {
    foes, allies: [], round: 1, phase: 'init', first: f.first ?? 'roll', queue: [], buffs: {}, fled: [], noFlee: !!f.noFlee,
    untilHit: !!f.untilHit, capture: !!f.capture, bound: [], saves: [],
    ret: { win: f.win ? [...path, 'win'] : undefined, fled: f.fled ? [...path, 'fled'] : undefined, routed: f.routed ? [...path, 'routed'] : undefined, lost: f.lost ? [...path, 'lost'] : undefined },
    uid: uid0 + foes.length,
  };
  for (const h of living(c.s)) if (h.nextInvis) {
    cb.buffs[h.seat] = { invis: true };
    delete h.nextInvis;
  }
  // спящие (белый дракон — 38%)
  for (const fo of foes) {
    const sl = special(MONSTER[fo.m], 'sleep');
    if (sl?.chance && c.rng.int(100) < sl.chance) fo.asleep = true;
  }
  c.s.combat = cb;
  c.s.scene!.wait = { k: 'fight' };
  const names = groupNames(foes);
  story(c, { k: 'title', text: `Бой: ${names}`, img: foes[0].m });
  c.ev.push({ k: 'sfx', id: 'fight' });
  if (cb.first === 'foes') {
    sys(c, 'Опасность нападает сразу!');
    beginSide(c, 'foes');
  } else if (cb.first === 'party') {
    sys(c, 'Отряд застал противника врасплох.');
    beginSide(c, 'party');
  } else {
    const shooters = fighting(c).filter((h) => missileAttacks(h).length);
    if (shooters.length) {
      cb.phase = 'volley';
      cb.queue = shooters.map((h) => h.seat);
      sys(c, 'Можно выстрелить до схватки — без жребия.');
    } else beginInit(c);
  }
}

function groupNames(foes: FoeInst[]): string {
  const cnt = new Map<string, number>();
  for (const f of foes) {
    const base = MONSTER[f.m]?.name ?? f.name;
    const k = f.group.split(':')[1] || base;
    cnt.set(k, (cnt.get(k) ?? 0) + 1);
  }
  return [...cnt].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ');
}

function beginInit(c: Ctx): void {
  const cb = c.s.combat!;
  cb.phase = 'init';
  cb.init = {};
  cb.queue = [leader(c.s)?.seat ?? GM];
}

/** Жребий: вожак бросает d6 за отряд, ведущий — за опасности. */
export function rollInit(c: Ctx, seat: number, useSpell?: boolean): boolean {
  const cb = c.s.combat;
  if (!cb || cb.phase !== 'init') return false;
  if (seat !== GM) {
    if (cb.init?.party != null) return false;
    const h = hero(c, seat);
    if (useSpell && h) {
      const sp = h.spells.find((x) => x.id === 'iniciativa' && (x.left ?? 1) > 0);
      if (!sp) return false;
      if (sp.left != null) sp.left--;
      sys(c, `${h.name} читает заклинание «Инициатива» — отряд бьёт первым.`);
      beginSide(c, 'party');
      cb.first = 'party';
      return true;
    }
    cb.init = { ...cb.init, party: rollD(c, seat, 'Кто бьёт первым — отряд', 'd6').v };
    cb.queue = [GM];
    return true;
  }
  if (cb.init?.party == null || cb.init.foes != null) return false;
  const v = rollD(c, GM, 'Кто бьёт первым — опасность', 'd6').v;
  const p = cb.init.party;
  if (v === p) {
    sys(c, `Поровну (${p} : ${v}) — перебрасываем.`);
    beginInit(c);
    return true;
  }
  const first = p > v ? 'party' : 'foes';
  sys(c, `Первыми бьют ${first === 'party' ? 'герои' : 'опасности'} (${p} : ${v}).`);
  cb.first = first;
  beginSide(c, first);
  return true;
}

function beginSide(c: Ctx, side: 'party' | 'foes'): void {
  const cb = c.s.combat!;
  for (const f of cb.foes) f.hits = 0;
  if (side === 'party') {
    cb.phase = 'party';
    cb.queue = fighting(c).map((h) => h.seat);
    if (!cb.queue.length) endSide(c);
  } else {
    cb.phase = 'foes';
    cb.queue = [GM];
  }
}

/** Сторона отходила — следующая сторона или новый раунд. */
function endSide(c: Ctx): void {
  const cb = c.s.combat;
  if (!cb || checkEnd(c)) return;
  const firstSide = cb.first === 'foes' ? 'foes' : 'party';
  if (cb.phase === 'party') {
    alliesStrike(c);
    if (checkEnd(c)) return;
    if (firstSide === 'party') beginSide(c, 'foes');
    else {
      cb.round++;
      beginSide(c, 'foes');
    }
  } else {
    if (firstSide === 'foes') beginSide(c, 'party');
    else {
      cb.round++;
      beginSide(c, 'party');
    }
  }
}

// ---------- удары героев

/** Герой начинает удар (выстрел): этот щелчок — его бросок на попадание. Урон и следующие стрелы — отдельными
 * бросками героя (strikeNext). Вернёт false — нельзя; иначе удар начат (он может сразу и закончиться). */
export function heroAttack(c: Ctx, h: Hero, atk: Attack, uid: number): boolean {
  const cb = c.s.combat!;
  const f = cb.foes.find((x) => x.uid === uid && !x.dead && !x.fled && !x.gone);
  if (!f || cb.strike) return false;
  if (heroNeed(h, atk, foeKd(f), cb.buffs[h.seat]) == null) {
    sys(c, `${h.name}: ${f.name} — убиваем только заклинанием.`);
    return true;
  }
  if (atk.ammo) {
    const it = h.items.find((x) => x.id === atk.ammo);
    if (it) removeItem(h, atk.ammo, 1);
  }
  cb.strike = { seat: h.seat, uid, atk, left: atk.shots, stage: 'hit' };
  strikeNext(c, h);
  return true;
}

/** Ждёт ли бой следующего броска этого героя (урон или ещё стрела). */
export const striking = (c: Ctx, seat: number) => c.s.combat?.strike?.seat === seat;

/** Следующий бросок удара: на попадание или на урон. */
export function strikeNext(c: Ctx, h: Hero): boolean {
  const cb = c.s.combat;
  const st = cb?.strike;
  if (!cb || !st || st.seat !== h.seat) return false;
  const f = cb.foes.find((x) => x.uid === st.uid);
  const atk = st.atk;
  const over = () => {
    st.left--;
    if (st.left > 0 && f && !f.dead && !f.fled && !f.gone) st.stage = 'hit';
    else delete cb.strike;
  };
  if (!f || f.dead || f.fled || f.gone) {
    delete cb.strike;
    return true;
  }
  const m = MONSTER[f.m];
  if (st.stage === 'hit') {
    const need = heroNeed(h, atk, foeKd(f), cb.buffs[h.seat]) ?? 18;
    const r = rollMain(c, h.seat, `${h.name}: ${atk.missile ? 'выстрел' : 'удар'} — ${f.name}`, need);
    if (!r.ok) {
      c.ev.push({ k: 'miss', from: h.name, to: f.name });
      sys(c, `${h.name} промахивается (${r.v}, нужно ${need}+).`);
      over();
      return true;
    }
    if (f.asleep) {
      f.sleepHits = (f.sleepHits ?? 0) + 1;
      if (f.sleepHits >= 2) {
        delete f.asleep;
        say(c, `${f.name} просыпается!`);
      }
    }
    // сразить серебром
    const silver = special(m, 'silver');
    if (silver?.on && atk.id === 'dagger_silver' && r.v >= silver.on) {
      sys(c, `Серебряный кинжал сражает оборотня (${r.v}).`);
      killFoe(c, f, h.seat);
      over();
      return true;
    }
    if (special(m, 'spellOnly')) {
      sys(c, `${f.name}: оружие не берёт — убиваем только заклинанием.`);
      over();
      return true;
    }
    const immune = special(m, 'weaponImmune');
    if (immune?.weapons?.some((w) => (w.includes('меч') && /sword/.test(atk.id)) || (w.includes('топор') && /axe/.test(atk.id)))) {
      sys(c, `${atk.name} против ${f.name.toLowerCase()} бессилен.`);
      over();
      return true;
    }
    sys(c, `${h.name} попадает (${r.v}) — бросок на урон.`);
    st.stage = 'dmg';
    return true;
  }
  // урон
  const p = pick(atk.dmg, c.rng);
  rollEv(c, h.seat, `${h.name}: урон — ${f.name}`, p);
  let dmg = p.v + atk.extra + (h.cls ? CLASSES[h.cls].dmgBonus : 0);
  const gb = special(m, 'goldBonus');
  if (gb?.bonus && /gold/.test(atk.id)) dmg += gb.bonus;
  const sb = special(m, 'silverBonus');
  if (sb?.bonus && /silver/.test(atk.id)) dmg += sb.bonus;
  if (f.m === 'chelyust' && atk.id === 'spear') dmg += 2;
  hitFoe(c, f, dmg, h.seat, h.name);
  if (cb.untilHit) {
    say(c, 'После первого же попадания противники исчезают.');
    for (const x of cb.foes) x.gone = true;
    delete cb.strike;
    return true;
  }
  over();
  return true;
}

/** Показать на экране бросок из pick (d6, d3 или основной). */
function rollEv(c: Ctx, seat: number, label: string, p: { v: number; die: string; face: number }): void {
  if (p.die === 'd6' || p.die === 'd3') c.ev.push({ k: 'roll', seat, label, dice: [{ die: p.die, face: p.face }], v: p.v });
  else if (p.die === '3d') c.ev.push({ k: 'roll', seat, label, dice: [{ die: 'd3', face: Math.floor((p.face - 1) / 6) + 1 }, { die: 'd6', face: ((p.face - 1) % 6) + 1 }], v: p.v });
}

function hitFoe(c: Ctx, f: FoeInst, dmg: number, by: number, byName: string): void {
  const cb = c.s.combat!;
  dmg = Math.max(0, dmg);
  f.hp = Math.round((f.hp - dmg) * 2) / 2;
  f.lastHit = by;
  c.ev.push({ k: 'hit', from: byName, to: f.name, dmg, kill: f.hp <= 0 });
  if (f.hp <= 0) {
    sys(c, `${byName} поражает: ${f.name} — −${fmtHp(dmg)} ОР. Опасность повержена!`);
    killFoe(c, f, by);
    return;
  }
  sys(c, `${byName} попадает: ${f.name} — −${fmtHp(dmg)} ОР.`);
  if (f.fleeAt != null && f.hp <= f.fleeAt) {
    f.fled = true;
    say(c, `${f.name} убегает!`);
    return;
  }
  moraleCheck(c, f);
  void cb;
}

function killFoe(c: Ctx, f: FoeInst, by: number): void {
  const cb = c.s.combat!;
  f.dead = true;
  f.hp = Math.min(f.hp, 0);
  let value = f.value;
  if (f.blind) value = Math.round((value * 2) / 3);
  // ИО — тому, кто добил; фантом — хозяину половину
  const ally = cb.allies.find((a) => a.id === `ph${by}`);
  const owner = by >= 100 ? Math.floor(by / 100) : by;
  const h = hero(c, owner);
  if (h && value > 0) {
    const v = by >= 100 || ally ? Math.round(value / 2) : value;
    h.kills.push({ name: MONSTER[f.m]?.name ?? f.name, value: v });
    sys(c, `${h.name}: +${v} ИО (${MONSTER[f.m]?.name ?? f.name}).`);
    addXp(c, h, v);
  }
  // мораль остальных равнозначных — когда убита половина
  const group = cb.foes.filter((x) => x.group === f.group);
  const deadN = group.filter((x) => x.dead).length;
  if (group.length > 1 && deadN * 2 >= group.length) for (const x of group) if (!x.dead && !x.fled) moraleCheck(c, x, true);
}

function moraleCheck(c: Ctx, f: FoeInst, force = false): void {
  if (f.moraleDone || f.dead || f.fled) return;
  if (f.morale == null || f.morale === 'am') return;
  if (!force && f.hp > f.hpMax / 2) return;
  f.moraleDone = true;
  const r = rollMain(c, GM, `Мораль: ${f.name}`, f.morale);
  if (r.ok) {
    f.fled = true;
    say(c, `${f.name} убегает (мораль ${r.v}).`);
  }
}

// ---------- союзники (спутники и фантомы)

function alliesStrike(c: Ctx): void {
  const cb = c.s.combat!;
  const all: (Ally & { seatKey: number })[] = [
    ...c.s.party.allies.filter((a) => !a.dead).map((a) => ({ ...a, seatKey: -1 })),
    ...cb.allies.filter((a) => !a.dead).map((a) => ({ ...a, seatKey: (a.owner ?? 0) * 100 + 1 })),
  ];
  for (const a of all) {
    const foes = activeFoes(cb);
    if (!foes.length) return;
    const f = foes[c.rng.int(foes.length)];
    const need = needToHit(foeKd(f));
    if (need == null) continue;
    const r = mainRoll(c.rng);
    if (r.v < need) {
      sys(c, `${a.name} промахивается.`);
      continue;
    }
    const by = a.seatKey > 0 ? a.seatKey : leader(c.s)?.seat ?? 0;
    hitFoe(c, f, pick(a.dmg, c.rng).v, by, a.name);
  }
}

// ---------- ход опасностей

type Target = { kind: 'hero'; h: Hero } | { kind: 'ally'; a: Ally; party: boolean };

function targets(c: Ctx): Target[] {
  const cb = c.s.combat!;
  const out: Target[] = fighting(c).map((h) => ({ kind: 'hero', h }) as Target);
  for (const a of c.s.party.allies) if (!a.dead) out.push({ kind: 'ally', a, party: true });
  for (const a of cb.allies) if (!a.dead) out.push({ kind: 'ally', a, party: false });
  return out;
}

/** Ведущий ведёт опасности: каждая бьёт («в кого — разыгрывается»), особые атаки → броски удачи героев. */
export function foesAct(c: Ctx, pickTargets?: Record<number, number>): boolean {
  const cb = c.s.combat;
  if (!cb || cb.phase !== 'foes') return false;
  for (const f of activeFoes(cb)) {
    if (f.asleep) continue;
    const pool = targets(c);
    if (!pool.length) break;
    const m = MONSTER[f.m];
    // дыхание драконов
    const br = special(m, 'breath');
    const breaths = f.breaths ?? 0;
    if (br?.chance && breaths < 3 && c.rng.int(100) < br.chance) {
      f.breaths = breaths + 1;
      const kinds = (br.kinds as string[] | undefined) ?? ['fire'];
      const kind = kinds[c.rng.int(kinds.length)];
      say(c, `${f.name} ${kind === 'fire' ? 'дышит огнём' : kind === 'gas' ? 'выдыхает ядовитый газ' : 'плюётся кислотой'}!`);
      for (const t of pool) {
        if (t.kind === 'hero') queueSave(c, t.h, kind, (br.save as number) ?? 12, 'hp3d', `Дух дракона — ${f.name}`, f.m);
        else {
          const d = mainRoll(c.rng).v;
          damageAlly(c, t.a, d, f.name);
        }
      }
      continue;
    }
    const multi = special(m, 'multiAttack') || f.attacks.filter((a) => a.dmg.length || a.effect).length > 1 && f.attacks.every((a) => a.name);
    const atks = f.attacks.filter((a) => a.dmg.length || a.effect);
    const list = multi ? atks.filter((a) => a.effect !== 'breath') : atks.slice(0, 1);
    const pickT = (): Target => {
      const want = pickTargets?.[f.uid];
      const t = want != null ? pool.find((x) => x.kind === 'hero' && x.h.seat === want) : undefined;
      return t ?? pool[c.rng.int(pool.length)];
    };
    const t = pickT();
    for (const a of list) {
      if (a.effect === 'breath') continue;
      foeStrike(c, f, a, t);
      if (t.kind === 'hero' && !alive(t.h)) break;
    }
  }
  cb.phase = cb.saves.length ? 'saves' : 'foes';
  if (cb.saves.length) {
    cb.queue = [...new Set(cb.saves.map((s) => s.seat))];
    return true;
  }
  endSide(c);
  return true;
}

function damageAlly(c: Ctx, a: Ally, d: number, by: string): void {
  a.hp = Math.round((a.hp - d) * 2) / 2;
  sys(c, `${by} ранит ${a.name}: −${fmtHp(d)} ОР.`);
  if (a.hp <= 0) {
    a.dead = true;
    sys(c, `${a.name} пал.`);
    c.s.party.allies = c.s.party.allies.filter((x) => x.id !== a.id);
  }
}

function foeStrike(c: Ctx, f: FoeInst, a: FoeInst['attacks'][number], t: Target): void {
  const cb = c.s.combat!;
  const m = MONSTER[f.m];
  let kd: number;
  if (t.kind === 'hero') {
    const b = cb.buffs[t.h.seat];
    kd = heroKd(t.h, b);
    if (b?.invis) kd = invisKd(kd);
  } else kd = t.a.kd;
  if (f.blind) kd -= 3;
  let need = needToHit(kd);
  // фоербарт: попадает независимо от КД на 14 и более
  if (f.m === 'foerbart') need = 14;
  const tName = t.kind === 'hero' ? t.h.name : t.a.name;
  if (need == null) {
    sys(c, `${f.name} не может достать ${tName}.`);
    return;
  }
  // порча кувшина: герой без чувств — противник раз попадает точно
  if (t.kind === 'hero' && t.h.stunNext) {
    delete t.h.stunNext;
    say(c, `${t.h.name} вдруг падает без чувств — ${f.name} бьёт наверняка!`);
    need = 1;
  }
  const r = mainRoll(c.rng);
  c.ev.push({ k: 'roll', seat: GM, label: `${f.name} → ${tName}${a.name ? ` (${a.name})` : ''}`, dice: [{ die: 'd3', face: Math.floor((r.v - 1) / 6) + 1 }, { die: 'd6', face: ((r.v - 1) % 6) + 1 }], v: r.v, need, ok: r.v >= need });
  if (r.v < need) {
    c.ev.push({ k: 'miss', from: f.name, to: tName });
    sys(c, `${f.name} промахивается по ${tName}.`);
    return;
  }
  if (t.kind === 'ally') {
    damageAlly(c, t.a, a.dmg.length ? pick(a.dmg, c.rng).v : mainRoll(c.rng).v, f.name);
    return;
  }
  const h = t.h;
  if (h.wardFirst) {
    delete h.wardFirst;
    say(c, `${f.name} попадает в ${h.name} — но удар соскальзывает: оберег волшебной воды!`);
    return;
  }
  if (cb.capture) {
    if (!cb.bound.includes(h.seat)) cb.bound.push(h.seat);
    say(c, `${h.name} схвачен и связан.`);
    return;
  }
  // атака-эффект без урона
  if (a.effect && !a.dmg.length) {
    const sp = special(m, a.effect === 'death' ? 'death' : a.effect) ?? special(m, 'lightning') ?? special(m, 'engulf');
    if (a.effect === 'frank') {
      const d = mainRoll(c.rng).v * (c.rng.int(3) + 1);
      hurt(c, h, d, f.name);
      return;
    }
    if (a.effect === 'death') {
      const save = (sp?.save as number) ?? (special(m, 'engulf')?.save as number) ?? 18;
      queueSave(c, h, f.m === 'lipuchka' ? 'engulf' : 'magic', save, 'death', `${f.name}: ${a.name ?? 'смерть'}`, f.m);
      return;
    }
    if (a.effect === 'paralysis' || a.effect === 'petrify' || a.effect === 'poison') {
      const sp2 = special(m, a.effect);
      if (sp2?.on) {
        const r2 = mainRoll(c.rng);
        if (r2.v < sp2.on) {
          sys(c, `${f.name}: ${a.name} не подействовал (${r2.v}).`);
          return;
        }
      }
      queueSave(c, h, a.effect, (sp2?.save as number) ?? 12, a.effect === 'petrify' ? 'stone' : 'hp3d', `${f.name}: ${a.name}`, f.m);
      return;
    }
    if (a.effect === 'xp') {
      // рудра: 75% — отнимает ИО по таблице
      const loss = [50, 100, 150, 200, 250, 300][c.rng.int(6)];
      h.xp = Math.max(0, h.xp - loss);
      sys(c, `${f.name} кусает ${h.name}: −${loss} ИО.`);
      return;
    }
    return;
  }
  const dmg = pick(a.dmg, c.rng).v;
  // квант: три попадания — одно очко
  if (f.m === 'kvant') {
    const k = ((h as any)._kvant ?? 0) + 1;
    (h as any)._kvant = k % 3;
    if (k % 3) {
      sys(c, `${f.name} жалит ${h.name} (${k} из 3).`);
      return;
    }
  }
  c.ev.push({ k: 'hit', from: f.name, to: h.name, dmg });
  hurt(c, h, dmg, f.name);
  // тень: сила −1
  const drain = special(m, 'statDrain');
  if (drain && f.m === 'ten' && alive(h)) {
    h.stats.str = Math.max(1, h.stats.str - 1);
    sys(c, `${h.name}: сила −1 (${h.stats.str}).`);
  }
  if (!alive(h)) return;
  // повторный бросок ведущего: паралич/яд/окаменение «N и более»
  for (const kind of ['paralysis', 'poison', 'petrify', 'fire'] as const) {
    const sp = special(m, kind);
    if (!sp?.on) continue;
    if (f.attacks.some((x) => x.effect === kind)) continue;
    const r2 = mainRoll(c.rng);
    if (r2.v >= sp.on) queueSave(c, h, kind, (sp.save as number) ?? 12, kind === 'petrify' ? 'stone' : 'hp3d', `${f.name}: ${kind === 'paralysis' ? 'паралич' : kind === 'poison' ? 'яд' : kind === 'fire' ? 'огонь' : 'окаменение'}`, f.m);
  }
}

/** Герою нужно бросить БУ. Обереги и заклинания-обереги спасают без броска. */
function queueSave(c: Ctx, h: Hero, kind: string, need: number, fail: PendingRoll['fail'], label: string, source: string): void {
  const cb = c.s.combat!;
  const why = warded(h, kind, source);
  if (why) {
    sys(c, `${h.name}: ${label} — спасает ${why}.`);
    return;
  }
  const wardSpell = h.spells.find((s) => SPELL[s.id]?.kind === `ward:${kind === 'gas' ? 'acid' : kind}` && (s.left ?? 1) > 0);
  if (wardSpell) {
    if (wardSpell.left != null) wardSpell.left--;
    sys(c, `${h.name} читает «${SPELL[wardSpell.id].name}» — ${label.toLowerCase()} не действует.`);
    return;
  }
  cb.saves.push({ seat: h.seat, kind: 'save', need: kind === 'engulf' ? need : saveNeed(h, need), label: `БУ: ${label}`, fail, from: 'combat' });
}

/** Герой бросает БУ в бою. */
export function combatSave(c: Ctx, seat: number): boolean {
  const cb = c.s.combat;
  if (!cb || cb.phase !== 'saves') return false;
  const i = cb.saves.findIndex((s) => s.seat === seat);
  if (i < 0) return false;
  const sv = cb.saves[i];
  cb.saves.splice(i, 1);
  const h = hero(c, seat)!;
  const r = rollMain(c, seat, sv.label, sv.need as number);
  if (r.ok) sys(c, `${h.name} спасся (${r.v}, нужно ${sv.need}+).`);
  else if (alive(h)) {
    if (sv.fail === 'death') die(c, h);
    else if (sv.fail === 'stone') {
      h.stone = true;
      story(c, { k: 'sys', text: `🗿 ${h.name} окаменел.` });
    } else hurt(c, h, rollMain(c, GM, `${sv.label.replace('БУ: ', '')}: сколько ОР`).v, sv.label.replace('БУ: ', ''));
  }
  cb.queue = [...new Set(cb.saves.map((s) => s.seat))].filter((s) => alive(hero(c, s)!));
  cb.saves = cb.saves.filter((s) => alive(hero(c, s.seat)!));
  if (!cb.saves.length) {
    cb.phase = 'foes';
    endSide(c);
  }
  return true;
}

// ---------- прочие действия героя в бою

export function heroDone(c: Ctx, seat: number): void {
  const cb = c.s.combat;
  if (!cb) return;
  cb.queue = cb.queue.filter((s) => s !== seat);
  if (checkEnd(c)) return;
  if (cb.phase === 'volley' && !cb.queue.length) beginInit(c);
  else if (cb.phase === 'party' && !cb.queue.length) endSide(c);
}

export function tryFlee(c: Ctx, h: Hero): boolean {
  const cb = c.s.combat!;
  if (cb.noFlee) return false;
  const foes = activeFoes(cb);
  // самая быстрая опасность решает: берём худший для героя список
  let flee: number[] | null = [1, 2, 3, 4, 5, 6];
  for (const f of foes) {
    const fl = f.flee;
    if (fl === 'never') {
      flee = null;
      break;
    }
    if (Array.isArray(fl) && fl.length < (flee?.length ?? 7)) flee = fl;
  }
  if (!flee) {
    sys(c, `${h.name}: от этой опасности не убежать.`);
    return true;
  }
  const r = rollD(c, h.seat, `${h.name}: бегство`, 'd6', flee);
  if (r.ok) {
    cb.fled.push(h.seat);
    say(c, `${h.name} убегает!`);
  } else sys(c, `${h.name} не смог убежать (${r.v}, нужно ${flee.join(', ')}).`);
  return true;
}

/** Кого отгоняет класс: маг — каменных и оборотней, крон — животных. */
export function turnSet(kind: 'stone' | 'animals'): Set<string> {
  return kind === 'stone' ? new Set([...STONE, ...WERE]) : ANIMALS;
}

/** Отгон: маг — каменных и оборотней, крон — животных. */
export function tryTurn(c: Ctx, h: Hero): boolean {
  const cb = c.s.combat!;
  const kind = h.cls ? CLASSES[h.cls].turn : undefined;
  if (!kind) return false;
  const set = turnSet(kind);
  const foes = activeFoes(cb).filter((f) => set.has(f.m));
  if (!foes.length) return false;
  const need = Math.max(2, 9 - h.level);
  const r = rollMain(c, h.seat, `${h.name}: отгон`, need);
  if (r.ok) {
    for (const f of foes) f.gone = true;
    say(c, `${h.name} отгоняет: ${foes.map((f) => f.name).join(', ')}.`);
  } else sys(c, `Отгон не удался (${r.v}, нужно ${need}+).`);
  return true;
}

/** Святая вода (оборотни) и аконит (мертвецы). */
export function useRepel(c: Ctx, h: Hero, id: 'holy_water' | 'aconite'): boolean {
  const cb = c.s.combat!;
  const set = id === 'holy_water' ? WERE : UNDEAD;
  const foes = activeFoes(cb).filter((f) => set.has(f.m));
  if (!foes.length || !removeItem(h, id, 1)) return false;
  for (const f of foes) f.gone = true;
  say(c, `${h.name} ${id === 'holy_water' ? 'брызгает святой водой' : 'поднимает священный аконит'} — ${foes.map((f) => f.name).join(', ')} отступают.`);
  return true;
}

/** Кол: «убить колом 8и» (вулин, некрофаг). */
export function useStake(c: Ctx, h: Hero, uid: number): boolean {
  const cb = c.s.combat!;
  const f = activeFoes(cb).find((x) => x.uid === uid);
  const sp = f && special(MONSTER[f.m], 'stake');
  if (!f || !sp || !h.items.some((x) => x.id === 'stake')) return false;
  const r = rollMain(c, h.seat, `${h.name}: кол — ${f.name}`, (sp.on as number) ?? 8);
  if (r.ok) {
    say(c, `${h.name} вонзает кол — ${f.name} повержен!`);
    killFoe(c, f, h.seat);
  } else sys(c, `Мимо (${r.v}).`);
  return true;
}

/** Заклинание в бою. target — uid опасности или место героя. */
export function castInCombat(c: Ctx, h: Hero, id: string, target?: number): boolean {
  const cb = c.s.combat!;
  const slot = h.spells.find((s) => s.id === id && (s.left == null || s.left > 0));
  const sp = SPELL[id];
  if (!slot || !sp) return false;
  const [kind, a, b] = sp.kind.split(':');
  const use = () => {
    if (slot.left != null) slot.left--;
  };
  const foeSaves = (f: FoeInst) => {
    const save = sp.save ?? 12;
    const r = rollMain(c, GM, `${f.name}: бросок удачи против «${sp.name}»`, save);
    if (r.ok) sys(c, `${f.name} устоял (${r.v}).`);
    return r.ok;
  };
  const needHit = (f: FoeInst) => {
    const need = needToHit(foeKd(f) + (h.cls ? CLASSES[h.cls].hitBonus : 0));
    const r = rollMain(c, h.seat, `${h.name}: «${sp.name}» — ${f.name}`, need ?? 18);
    return r.ok;
  };
  const foe = target != null ? activeFoes(cb).find((f) => f.uid === target) : undefined;
  switch (kind) {
    case 'escape':
    case 'escape33': {
      use();
      if (kind === 'escape33' && c.rng.int(100) < 33) {
        sys(c, `«${sp.name}» не подействовал.`);
        return true;
      }
      say(c, `${h.name}: «${sp.name}» — отряд уходит от опасности.`);
      for (const x of fighting(c)) cb.fled.push(x.seat);
      return true;
    }
    case 'repel':
    case 'weaken':
    case 'web':
    case 'kill': {
      if (!foe) return false;
      use();
      if (sp.target && !needHit(foe)) {
        sys(c, `${h.name} не попал — заклинание пропало.`);
        return true;
      }
      const victims = kind === 'kill' && Number(a) > 1 || kind === 'web' ? activeFoes(cb).slice(0, kind === 'web' ? 1 + c.rng.int(5) : Number(a)) : [foe];
      if (!victims.includes(foe)) victims.unshift(foe);
      for (const f of victims) {
        if (foeSaves(f)) continue;
        if (kind === 'repel') {
          f.gone = true;
          say(c, `${f.name} отступает.`);
        } else if (kind === 'weaken') {
          f.weak = true;
          sys(c, `${f.name} ослаб (КД +2).`);
        } else if (kind === 'web') {
          f.hp = Math.max(0.5, f.hp / 2);
          addXp(c, h, Math.round(f.value / 2));
          sys(c, `${f.name} в паутине: половина ОР.`);
        } else {
          const share = Number(b) || 1;
          f.dead = true;
          f.hp = 0;
          const v = Math.round(f.value / share);
          if (v) {
            h.kills.push({ name: MONSTER[f.m]?.name ?? f.name, value: v });
            addXp(c, h, v);
          }
          say(c, `${f.name} испепелён!`);
        }
      }
      return true;
    }
    case 'fear':
    case 'fireball':
    case 'blind': {
      use();
      const n = kind === 'fear' ? Number(a) : kind === 'fireball' ? rollMain(c, h.seat, `${h.name}: «${sp.name}» — сколько опасностей накроет`).v : 10;
      for (const f of activeFoes(cb).slice(0, n)) {
        if (foeSaves(f)) continue;
        if (kind === 'fear') f.gone = true;
        else if (kind === 'fireball') {
          f.dead = true;
          f.hp = 0;
        } else f.blind = true;
      }
      say(c, `${h.name}: «${sp.name}»!`);
      return true;
    }
    case 'buff': {
      use();
      cb.buffs[h.seat] = { ...(cb.buffs[h.seat] ?? {}), [a]: (cb.buffs[h.seat]?.[a as 'str' | 'dex'] ?? 0) + Number(b) };
      sys(c, `${h.name}: «${sp.name}» — ${a === 'str' ? 'сила' : 'ловкость'} +${b} на этот бой.`);
      return true;
    }
    case 'invis':
    case 'invis2': {
      use();
      cb.buffs[h.seat] = { ...(cb.buffs[h.seat] ?? {}), invis: true };
      sys(c, `${h.name} становится невидимым.`);
      return true;
    }
    case 'phantom': {
      use();
      const n = Number(a);
      const atk = meleeAttack(h);
      for (let i = 0; i < n; i++) cb.allies.push({ id: `ph${h.seat}`, name: `Фантом ${h.name}`, hp: h.hpMax, hpMax: h.hpMax, kd: heroKd(h), dmg: atk.dmg, owner: h.seat });
      say(c, `Рядом с ${h.name} появляется ${n > 1 ? `${n} фантома` : 'фантом'}.`);
      return true;
    }
    case 'heal': {
      const t = target != null ? hero(c, target) : h;
      if (!t || !alive(t)) return false;
      use();
      const before = t.hp;
      t.hp = a === 'full' ? Math.max(t.hp, t.hpMax) : Math.min(t.hpMax + Number(a), t.hp + Number(a));
      if (a !== 'full') t.hpMax = Math.max(t.hpMax, t.hp);
      sys(c, `${h.name} лечит ${t.name}: +${fmtHp(t.hp - before)} ОР.`);
      return true;
    }
    default:
      return false;
  }
}

// ---------- конец боя

function checkEnd(c: Ctx): boolean {
  const cb = c.s.combat;
  if (!cb) return true;
  const foes = activeFoes(cb);
  const heroesLeft = fighting(c);
  if (!foes.length) {
    const routed = cb.foes.some((f) => f.fled);
    finishFight(c, routed && cb.ret.routed ? 'routed' : 'win');
    return true;
  }
  if (!living(c.s).length || (cb.capture && !heroesLeft.length && cb.bound.length)) {
    finishFight(c, 'lost');
    return true;
  }
  if (!heroesLeft.length) {
    finishFight(c, 'fled');
    return true;
  }
  return false;
}

function finishFight(c: Ctx, how: 'win' | 'routed' | 'fled' | 'lost'): void {
  const cb = c.s.combat!;
  const gold = cb.foes.filter((f) => f.dead).reduce((a, f) => a + f.gold, 0);
  c.s.combat = null;
  if (how === 'win' || how === 'routed') {
    story(c, { k: 'sys', text: how === 'win' ? 'Бой окончен — победа.' : 'Противник бежал.' });
    if (gold) giveGoldParty(c, living(c.s), gold);
  } else if (how === 'fled') story(c, { k: 'sys', text: 'Отряд ушёл от опасности.' });
  else story(c, { k: 'sys', text: cb.capture ? 'Отряд схвачен.' : 'Отряд пал в бою.' });
  const sr = c.s.scene;
  if (!sr) return;
  sr.wait = undefined;
  const path = how === 'win' ? cb.ret.win : how === 'routed' ? cb.ret.routed ?? cb.ret.win : how === 'fled' ? cb.ret.fled : cb.ret.lost;
  if (how === 'fled' && !path) {
    // убежали — сцена не окончена, в комнату можно вернуться
    sr.ended = 'repeat';
    sr.stack = [];
  } else if (how === 'lost' && !path) {
    sr.stack = [];
  } else if (path) sr.stack.push({ path, i: 0 });
  run(c);
  if (!c.s.scene) hooks.afterScene(c);
}

export function canAct(c: Ctx, seat: number): boolean {
  const cb = c.s.combat;
  return !!cb && cb.queue.includes(seat);
}

export { missileAttacks, meleeAttack, wards };
