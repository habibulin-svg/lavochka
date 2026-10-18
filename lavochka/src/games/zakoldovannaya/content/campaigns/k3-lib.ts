/* Кампания k3 «Драконья осень» — общие помощники для глав. */
import type { Cond, PlanData, Scene, Site, Step } from '../../script';
import type { Trigger } from '../campaigns';

export type SceneDef = Omit<Scene, 'id'>;

/** Сцены кампании: ключ → сцена с id 'camp:k3:<ключ>'. */
export const camp = (defs: Record<string, SceneDef>): Record<string, Scene> =>
  Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, { ...v, id: `camp:k3:${k}` }]));

/** Сцены комнат своего места: id 'site:<место>:<комната>'. */
export const roomsOf = (site: string, defs: Record<string, SceneDef>): Record<string, Scene> =>
  Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, { ...v, id: `site:${site}:${k}` }]));

type RoomKind = PlanData['rooms'][number]['kind'];
type LinkKind = PlanData['links'][number]['kind'];

/** Схема места: комнаты [id, x, y, вид], ходы [a, b, вид?] (по умолчанию дверь), входы. */
export function planOfRooms(rooms: [string, number, number, RoomKind?][], links: [string, string, LinkKind?][], entry: string[]): PlanData {
  return {
    images: [null],
    sizes: [[520, 330]],
    rooms: rooms.map(([id, x, y, kind]) => ({ id, x, y, r: 18, kind: kind ?? 'room', img: 0 })),
    links: links.map(([a, b, kind]) => ({ a, b, kind: kind ?? 'door' })),
    entry,
  };
}

export const flag = (f: string): Cond => ({ flag: `k3.${f}` });
export const notFlag = (f: string): Cond => ({ not: { flag: `k3.${f}` } });

/** Взведены хотя бы n флагов из списка (имена без префикса k3.). */
export function atLeast(n: number, flags: string[]): Cond {
  const fl = flags.map((f) => `k3.${f}`);
  const combos: string[][] = [];
  const rec = (start: number, cur: string[]) => {
    if (cur.length === n) return void combos.push([...cur]);
    for (let i = start; i < fl.length; i++) rec(i + 1, [...cur, fl[i]]);
  };
  rec(0, []);
  return { any: combos.map((c) => ({ all: c.map((f) => ({ flag: f })) })) };
}

/** Часть кампании, собираемая в главном файле. */
export interface Part {
  scenes: Record<string, Scene>;
  sites?: Record<string, Site>;
  places?: { node: number; site: string }[];
  triggers?: Trigger[];
  rooms?: Record<string, string>;
  roadScenes?: string[];
}

/** Подвода гномов: предложить доехать (боты и ленивые — соглашаются), иначе идти своим ходом. */
export const ride = (to: `site:${string}`, text: string, walk: string): Step => ({
  ask: 'Как доберётесь?',
  opts: [
    { text: `Поехать на гномьей подводе: ${text}`, bot: 3, do: ['Подвода скрипит всю ночь. Гномы-возчики поют, не фальшивя, и под их песню вы засыпаете на соломе.', { time: 1 }, { move: to }] },
    { text: walk, bot: 1, do: ['Вы решаете идти пешком: так вернее, и ноги разомнёте.'] },
  ],
});
