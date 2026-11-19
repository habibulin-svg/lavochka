/* Симулятор дирижёра — переложение: партию (как в партитуре) играет другой инструмент или несколько.
 * Октаву инструмент берёт сам: вся партия сдвигается на целые октавы так, чтобы середина легла в его диапазон,
 * отдельные ноты за краем — ещё на октаву. Ударные (литавры, тарелки) меняются только между собой. */
import type { Arrangement } from './career';
import { INSTR, notesOf, type InstrId, type PartJson, type ScoreJson } from './score';

/** Кого можно поставить вместо: мелодические — на мелодические, ударные — на ударные. */
export function canPlay(from: InstrId, to: InstrId): boolean {
  const pf = INSTR[from].family === 'perc' && from !== 'harp' && from !== 'cel';
  const pt = INSTR[to].family === 'perc' && to !== 'harp' && to !== 'cel';
  return pf === pt && (!pf || from === to || (from !== 'perc' && to !== 'perc'));
}

export function moveTo(p: PartJson, to: InstrId): PartJson {
  const ns = notesOf(p);
  if (!ns.length || to === p.instr) return { ...p, instr: to };
  const { lo, hi } = INSTR[to];
  const sorted = ns.map((n) => n.pitch).sort((a, b) => a - b);
  const mid = sorted[sorted.length >> 1];
  const center = (lo + hi) / 2;
  const shift = Math.round((center - mid) / 12) * 12;
  const notes: number[] = [];
  for (const n of ns) {
    let x = n.pitch + shift;
    while (x < lo && x + 12 <= hi + 12) x += 12;
    while (x > hi && x - 12 >= lo - 12) x -= 12;
    notes.push(n.tick, n.dur, x, n.vel + 128 * n.art);
  }
  return { name: p.name, instr: to, notes };
}

export function applyArrangement(s: ScoreJson, a: Arrangement | null): ScoreJson {
  if (!a) return s;
  const parts: PartJson[] = [];
  s.parts.forEach((p, i) => {
    const to = a.map[i];
    if (!to) {
      parts.push(p);
      return;
    }
    for (const t of to) if (canPlay(p.instr, t)) parts.push(moveTo(p, t));
  });
  return { ...s, parts, title: `${s.title} — ${a.name}` };
}
