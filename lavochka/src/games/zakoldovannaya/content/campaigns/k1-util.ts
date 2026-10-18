/* Кампания «Посох Белого мага» (k1) — общие помощники для глав. */
import type { Cond, Foe, PlanData, Scene, Site, Step } from '../../script';
import type { Trigger } from '../campaigns';

/** Сцена кампании k1: id получает префикс camp:k1:. */
export const cs = (id: string, o: Omit<Scene, 'id'>): Scene => ({ id: `camp:k1:${id}`, ...o });
/** Сцена комнаты своего места. */
export const rs = (site: string, room: string, o: Omit<Scene, 'id'>): Scene => ({ id: `site:${site}:${room}`, ...o });

export const F = (name: string): Cond => ({ flag: name });
export const NOT = (c: Cond): Cond => ({ not: c });
export const GOT_ALL: Cond = { all: [F('k1.part1'), F('k1.part2'), F('k1.part3')] };

/** Глава: сцены, места, события, подмены комнат замков книги. */
export interface Chapter {
  scenes: Scene[];
  sites?: Site[];
  places?: { node: number; site: string }[];
  triggers?: Trigger[];
  /** Подмена комнаты замка книги: 'c2:8' → id сцены (без префикса camp:k1:). */
  rooms?: Record<string, string>;
}

/** Часть Посоха найдена: флаг, дневник, и если все три — флаг k1.all. */
export function partGot(n: 1 | 2 | 3): Step[] {
  return [
    { set: `k1.part${n}` },
    { quest: `part${n}`, done: true },
    { if: GOT_ALL, then: [{ set: 'k1.all' }] },
  ];
}

/** Встречный, про которого известно только имя: проверка агрессивности d6 (1 спит, 2 замечает, 3–4 грубит, 5–6 нападает). */
export function meet(foes: Foe[], t: { calm: string; notice: string; rude: string; attack: string }, win?: Step[]): Step {
  const fight = (first?: 'foes'): Step => ({ fight: foes, ...(first ? { first } : {}), ...(win ? { win } : {}) });
  const rude: Step[] = [
    t.rude,
    {
      ask: 'Что ответите?',
      opts: [
        { text: 'Не связываться, пройти мимо', bot: 2, do: ['Вы молча проходите мимо, пропуская грубости мимо ушей.'] },
        { text: 'Ответить тем же', risky: true, do: [fight()] },
      ],
    },
  ];
  return { aggression: [[t.calm], [t.notice], rude, rude, [t.attack, fight('foes')]] };
}

/** Схема места: rooms — [id, x, y, kind?]; links — 'a-b' дверь, 'a~b' потайная, 'a^b' лестница, 'a=b' проём, 'a>b' ворота. */
export function mkPlan(rooms: [string, number, number, ('room' | 'corridor' | 'yard' | 'tower' | 'outside')?][], links: string[], entry: string[], size: [number, number] = [520, 330]): PlanData {
  const kinds: Record<string, PlanData['links'][number]['kind']> = { '-': 'door', '~': 'secret', '^': 'up', '=': 'open', '>': 'gate' };
  return {
    images: [null],
    sizes: [size],
    rooms: rooms.map(([id, x, y, kind]) => ({ id, x, y, r: kind === 'yard' ? 22 : 18, kind: kind ?? 'room' })),
    links: links.map((l) => {
      const m = /^([\w.]+)([-~^=>])([\w.]+)$/.exec(l);
      if (!m) throw new Error(`k1: плохая связь «${l}»`);
      return { a: m[1], b: m[3], kind: kinds[m[2]] };
    }),
    entry,
  };
}

/** Место-схема кампании. */
export function mkSite(id: string, title: string, outside: string, plan: PlanData, rooms: Scene[], opts: { card?: 0 | -1; enter?: Step[]; empty?: string } = {}): Site {
  const map: Record<string, Scene> = {};
  for (const sc of rooms) {
    const [, , room] = sc.id.split(':');
    map[room] = sc;
  }
  return { id, card: opts.card ?? 0, title, outside, plan, rooms: map, ...(opts.enter ? { enter: opts.enter } : {}), ...(opts.empty ? { empty: opts.empty } : {}) };
}
