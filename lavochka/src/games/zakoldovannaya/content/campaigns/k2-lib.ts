/* Кампания k2 «Красная собака» — общие помощники для глав. */
import type { Stat } from '../../book';
import type { Cond, Foe, PlanData, Scene, Step } from '../../script';
import { ask, end, fight, give, opt, roll, take, when } from '../../script';

export { ask, end, fight, give, opt, roll, take, when };
export type { Cond, Foe, Scene, Step };

export type Link = PlanData['links'][number]['kind'];

/** Сцена кампании k2: ключ в scenes — id без префикса. */
export function sc(id: string, title: string, steps: Step[], more: Partial<Scene> = {}): Scene {
  return { id: `camp:k2:${id}`, title, steps, ...more };
}

/** Комната своего места. */
export function room(site: string, id: string, title: string, steps: Step[], more: Partial<Scene> = {}): Scene {
  return { id: `site:${site}:${id}`, title, steps, ...more };
}

/** Собрать список сцен в таблицу по ключам. */
export function table(list: Scene[]): Record<string, Scene> {
  const out: Record<string, Scene> = {};
  for (const s of list) out[s.id.slice('camp:k2:'.length)] = s;
  return out;
}

/** Схема места: комнаты [id, x, y, r, вид], связи [a, b, вид?]. */
export function mkPlan(size: [number, number], rooms: [string, number, number, number, PlanData['rooms'][number]['kind']][], links: [string, string, Link?][], entry: string[]): PlanData {
  return {
    images: [null],
    sizes: [size],
    rooms: rooms.map(([id, x, y, r, kind]) => ({ id, x, y, r, kind })),
    links: links.map(([a, b, kind]) => ({ a, b, kind: kind ?? 'door' })),
    entry,
  };
}

// ---------- флаги и ход сюжета

export const stIs = (n: number): Cond => ({ flag: 'k2.st', is: n });
/** Сюжет дошёл до этапа n или дальше. */
export const stGte = (n: number): Cond => ({ any: [n, n + 1, n + 2, n + 3, n + 4, n + 5, n + 6, n + 7].map(stIs) });
export const F = (name: string): Cond => ({ flag: `k2.${name}` });
export const NF = (name: string): Cond => ({ not: { flag: `k2.${name}` } });
export const setf = (name: string): Step => ({ set: `k2.${name}` });
export const stage = (n: number): Step => ({ set: 'k2.st', v: n });

// ---------- частые приёмы

/** Проверка качества лучшим в отряде. */
export const skill = (stat: Stat, need: number, label: string, pass: Step[], fail: Step[] = []): Step =>
  roll({ kind: 'stat', stat, need, who: `best:${stat}`, label }, pass, fail);

/** Удача на основном броске (d3+d6): need из 18. */
export const luck = (need: number, label: string, pass: Step[], fail: Step[] = []): Step => roll({ kind: 'main', need, who: 'leader', label }, pass, fail);

/** Кости: четыре кубика против четырёх. */
export const dice4 = (label: string, pass: Step[], fail: Step[] = []): Step => roll({ kind: 'dice4', need: 0, who: 'leader', label }, pass, fail);

/** Платёж общей кассой отряда (кнопка доступна, если хватает денег). */
export const pay = (gold: number, text: string, ...steps: Step[]) => ({ text, if: { gold, who: 'party' } as Cond, bot: 1, do: [take({ gold, pool: true }), ...steps] });

/** Бой, где противник по силам отряда: low — слабый отряд, mid — уровень 2+, high — уровень 4+ у кого-нибудь. */
export function scaled(make: (foes: Foe[]) => Step, low: Foe[], mid: Foe[], high: Foe[] = mid): Step {
  return when({ level: 4, who: 'any' }, [make(high)], [when({ level: 2, who: 'any' }, [make(mid)], [make(low)])]);
}

/** Награда за этап: уровень каждому. */
export const levelUp = (text?: string): Step => give({ xp: 'level' }, 'each', text);

/** Предложить доехать до места (обоз, посланец): да — сразу, нет — своим ходом (дольше, но тоже до места: сюжет не теряется). */
export function lift(dest: string, yes: string, no: string, days = 1, _leave = true): Step {
  return ask('Как доберётесь?', [
    { text: 'Принять предложение — ехать', bot: 3, do: [yes, { time: days }, { move: dest as `site:${string}` }] },
    { text: 'Идти своим ходом (дольше)', bot: 0.3, do: [no, { time: days + 1 }, { move: dest as `site:${string}` }] },
  ]);
}
