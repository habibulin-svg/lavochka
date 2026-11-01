/* Уровень ГОПС из public/gops/levels/<id>.json (выгружает studio/post/export_levels.py из terrain.py):
 * маска — длины серий uint32 LE в base64, первая серия — воздух; плюс жидкость, точки высадки, места предметов. */
import { Mask } from './sim/mask';

export interface LevelData {
  id: string;
  size: [number, number];
  water_y: number;
  edges: { walls: boolean; ceiling: boolean };
  recipe: { archetype: string; seed: number; water: number; props: number };
  /** Упорядочены: любые первые N разнесены друг от друга. */
  spawns: [number, number][];
  props: { x: number; y: number; w: number; h: number }[];
  race?: { start: [number, number]; finish: [number, number] };
  rle: string;
}

function b64bytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeMask(lv: Pick<LevelData, 'size' | 'rle'>): Mask {
  const [w, h] = lv.size;
  const m = new Mask(w, h);
  const bytes = b64bytes(lv.rle);
  const runs = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  for (let i = 0; i * 4 < bytes.length; i++) {
    const n = runs.getUint32(i * 4, true);
    if (i & 1) m.d.fill(1, pos, pos + n);
    pos += n;
  }
  if (pos !== w * h) throw new Error(`маска уровня ${'id' in lv ? lv.id : ''}: ${pos} пикселей вместо ${w * h}`);
  return m;
}

export async function loadLevel(id: string, base = '/gops/levels/'): Promise<LevelData> {
  const r = await fetch(`${base}${id}.json`);
  if (!r.ok) throw new Error(`уровень ${id}: ${r.status}`);
  return r.json();
}

/** Раздать точки высадки бригадам: первые teams·perTeam, по кругу (как deal_spawns в terrain.py, без перемешивания). */
export function dealSpawns(spawns: [number, number][], teams: number, perTeam: number): [number, number][][] {
  const out: [number, number][][] = Array.from({ length: teams }, () => []);
  for (let i = 0; i < teams * perTeam && i < spawns.length; i++) out[i % teams].push(spawns[i]);
  return out;
}
