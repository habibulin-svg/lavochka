/* Проверка содержимого: опасности, вещи, бутылочки, заклинания, комнаты планов, переходы, куски сцен — всё должно
 * существовать. Запускается тестом (tests/zakoldovannaya.test.ts); авторы приключений — тоже: npx vitest run tests/zakoldovannaya. */
import { ARMORS, GEAR, MAGIC, SPELL, WEAPONS } from '../book';
import { MONSTER } from '../monsters';
import type { Cond, Scene, Site, Step } from '../script';
import { PLANS } from '../world';
import { BOOK_SITES } from './book';
import { CAMPAIGNS } from './campaigns';
import { ROAD } from './road';

const ITEMS = new Set<string>([...WEAPONS.map((w) => w.id), ...ARMORS.map((a) => a.id), ...GEAR.map((g) => g.id), 'shield']);
const TAKE_SPECIAL = new Set(['best-weapon', 'weapons', 'armor', 'iron', 'all']);

export function itemOk(id: string): boolean {
  if (ITEMS.has(id)) return true;
  if (/^loot:[a-z0-9_]+$/.test(id)) return true;
  const m = /^magic:(\d+)$/.exec(id);
  return !!m && Number(m[1]) >= 26 && Number(m[1]) <= 43;
}

function condErrors(c: Cond, where: string, out: string[]): void {
  if ('not' in c) return condErrors(c.not, where, out);
  if ('all' in c) return c.all.forEach((x) => condErrors(x, where, out));
  if ('any' in c) return c.any.forEach((x) => condErrors(x, where, out));
  if ('item' in c && !itemOk(c.item)) out.push(`${where}: нет вещи «${c.item}» (условие)`);
  if ('spell' in c && !SPELL[c.spell]) out.push(`${where}: нет заклинания «${c.spell}» (условие)`);
}

function walk(steps: Step[] | undefined, sc: Scene, site: Site | undefined, plan: string[] | undefined, where: string, out: string[]): void {
  if (!steps) return;
  if (!Array.isArray(steps)) {
    out.push(`${where}: ожидался список шагов`);
    return;
  }
  steps.forEach((st, i) => {
    const at = `${where}[${i}]`;
    if (typeof st === 'string') return;
    if ('say' in st && 'img' in st && st.img && !MONSTER[st.img] && !st.img.includes('.')) out.push(`${at}: картинка «${st.img}» — нет такой опасности`);
    if ('ask' in st) {
      if (!st.opts?.length) out.push(`${at}: вопрос без вариантов`);
      st.opts?.forEach((o, k) => {
        if (o.if) condErrors(o.if, `${at}.opts[${k}]`, out);
        walk(o.do, sc, site, plan, `${at}.opts[${k}]`, out);
      });
    }
    if ('if' in st) {
      condErrors(st.if, at, out);
      walk(st.then, sc, site, plan, `${at}.then`, out);
      walk(st.else, sc, site, plan, `${at}.else`, out);
    }
    if ('roll' in st) {
      const r = st.roll;
      if (!['main', 'save', 'd6', 'd3', 'hit', 'stat', 'dice4'].includes(r.kind)) out.push(`${at}: неизвестный бросок ${r.kind}`);
      if ((r.kind === 'd6' || r.kind === 'd3') && Array.isArray(r.need) && r.need.some((x) => x < 1 || x > (r.kind === 'd6' ? 6 : 3))) out.push(`${at}: грани кубика вне ${r.kind}`);
      if ((r.kind === 'main' || r.kind === 'save' || r.kind === 'hit') && typeof r.need !== 'number') out.push(`${at}: need должен быть числом`);
      walk(st.pass, sc, site, plan, `${at}.pass`, out);
      walk(st.fail, sc, site, plan, `${at}.fail`, out);
    }
    if ('fight' in st) {
      const foes = typeof st.fight === 'string' ? [{ m: st.fight }] : st.fight;
      if (!Array.isArray(foes) || !foes.length) out.push(`${at}: бой без противников`);
      else for (const f of foes) if (!MONSTER[f.m]) out.push(`${at}: нет опасности «${f.m}»`);
      for (const k of ['win', 'fled', 'routed', 'lost'] as const) walk(st[k], sc, site, plan, `${at}.${k}`, out);
    }
    if ('give' in st) {
      const g = st.give;
      if (g.item && !itemOk(g.item)) out.push(`${at}: нет вещи «${g.item}»`);
      if (g.bottles?.some((b) => !(b >= 1 && b <= 25))) out.push(`${at}: бутылочки — номера 1–25 (вещи 26–43 — через item: 'magic:N')`);
      if (g.spell && !SPELL[g.spell]) out.push(`${at}: нет заклинания «${g.spell}»`);
    }
    if ('take' in st && st.take.item && !TAKE_SPECIAL.has(st.take.item) && !itemOk(st.take.item)) out.push(`${at}: нет вещи «${st.take.item}» (take)`);
    if ('later' in st) walk(st.do, sc, site, plan, `${at}.later`, out);
    if ('each' in st) walk(st.each, sc, site, plan, `${at}.each`, out);
    if ('random' in st) st.random.forEach((b, k) => walk(b, sc, site, plan, `${at}.random[${k}]`, out));
    if ('aggression' in st) st.aggression.forEach((b, k) => walk(b, sc, site, plan, `${at}.aggression[${k}]`, out));
    if ('node' in st && !sc.nodes?.[st.node]) out.push(`${at}: нет куска сцены «${st.node}»`);
    if (('open' in st || 'goto' in st) && plan) {
      const id = 'open' in st ? st.open : (st as { goto: string }).goto;
      if (!plan.includes(id)) out.push(`${at}: на плане нет комнаты «${id}»`);
    }
    if ('move' in st && st.move.startsWith('site:') && !BOOK_SITES[st.move.slice(5)] && !Object.values(CAMPAIGNS).some((c) => c.sites?.[st.move.slice(5)])) out.push(`${at}: нет места «${st.move}»`);
    if ('shop' in st) for (const x of st.shop.stock ?? []) if (!itemOk(x.id)) out.push(`${at}: в лавке нет вещи «${x.id}»`);
    if ('gamble' in st) {
      walk(st.gamble.win, sc, site, plan, `${at}.win`, out);
      walk(st.gamble.lose, sc, site, plan, `${at}.lose`, out);
    }
  });
}

function lintScene(sc: Scene, key: string, site: Site | undefined, plan: string[] | undefined, out: string[]): void {
  if (sc.id !== key) out.push(`${key}: id сцены «${sc.id}» не совпадает с ключом`);
  if (sc.img && !MONSTER[sc.img] && !sc.img.includes('.')) out.push(`${key}: картинка «${sc.img}» — нет такой опасности`);
  walk(sc.steps, sc, site, plan, key, out);
  for (const [n, steps] of Object.entries(sc.nodes ?? {})) walk(steps, sc, site, plan, `${key}#${n}`, out);
}

export function lintSite(site: Site, campaign?: string): string[] {
  const out: string[] = [];
  const plan = (site.plan ?? PLANS[site.id])?.rooms.map((r) => r.id);
  if (site.plan) {
    const ids = new Set(site.plan.rooms.map((r) => r.id));
    for (const l of site.plan.links) if (!ids.has(l.a) || !ids.has(l.b)) out.push(`${site.id}: связь ${l.a}–${l.b} ведёт в несуществующую комнату`);
    for (const e of site.plan.entry) if (!ids.has(e)) out.push(`${site.id}: вход «${e}» не на схеме`);
  }
  walk(site.enter, { id: `enter:${site.id}`, steps: site.enter ?? [] }, site, plan, `enter:${site.id}`, out);
  for (const [room, sc] of Object.entries(site.rooms)) {
    if (plan && !plan.includes(room)) out.push(`${site.id}: комнаты «${room}» нет на плане`);
    lintScene(sc, `site:${site.id}:${room}`, site, plan, out);
  }
  void campaign;
  return out;
}

export function lintAll(): string[] {
  const out: string[] = [];
  for (const site of Object.values(BOOK_SITES)) out.push(...lintSite(site));
  const ids = new Set<string>();
  for (const sc of ROAD) {
    if (ids.has(sc.id)) out.push(`${sc.id}: повтор id`);
    ids.add(sc.id);
    lintScene(sc, sc.id, undefined, undefined, out);
  }
  for (const camp of Object.values(CAMPAIGNS)) {
    for (const sc of Object.values(camp.scenes)) lintScene(sc, sc.id, undefined, undefined, out);
    walk(camp.intro, { id: 'intro', steps: camp.intro }, undefined, undefined, `${camp.id}:intro`, out);
    for (const site of Object.values(camp.sites ?? {})) out.push(...lintSite(site, camp.id));
    for (const t of camp.triggers ?? []) if (!camp.scenes[t.scene]) out.push(`${camp.id}: триггер ведёт в несуществующую сцену «${t.scene}»`);
    for (const [k, v] of Object.entries(camp.rooms ?? {})) if (!camp.scenes[v]) out.push(`${camp.id}: подмена комнаты ${k} → нет сцены «${v}»`);
    for (const id of camp.roadScenes ?? []) if (!camp.scenes[id]) out.push(`${camp.id}: дорожной сцены «${id}» нет`);
    for (const p of camp.places ?? []) if (!camp.sites?.[p.site]) out.push(`${camp.id}: место на узле ${p.node} — нет места «${p.site}»`);
    for (const [id, sc] of Object.entries(camp.scenes)) if (sc.id !== `camp:${camp.id}:${id}`) out.push(`${camp.id}: сцена «${id}» должна иметь id «camp:${camp.id}:${id}»`);
  }
  return out;
}

/** Нумерованные комнаты планов книги без сцены (книга описывает каждую). */
export function uncovered(): string[] {
  const out: string[] = [];
  for (const [id, plan] of Object.entries(PLANS)) {
    const site = BOOK_SITES[id];
    if (!site) continue;
    for (const r of plan.rooms) if (/^\d/.test(r.id) && !site.rooms[r.id]) out.push(`${id}:${r.id}`);
  }
  return out;
}

export { MAGIC };
