/* Пулька — лист, как его чертят на бумаге: в центре кружок с ценой пули, лучи делят лист на сектора игроков.
 * В секторе от края к центру: висты (по клетке на каждого соперника — ближе к его сектору), пуля, гора.
 * Записи — нарастающим итогом через точку («2.4.6.10»), последняя — жирнее. Свой сектор — снизу.
 * Втроём лист делит вертикальный луч сверху и два луча в нижние углы: верхние клетки вистов — у левого и правого
 * (висты друг на друга), втроём и вчетвером всё остальное пишется вдоль своего края. */
import { esc } from '../../core/util';
import type { View } from './engine';

const S = 300;
/** Полосы от края: висты 0–30, пуля 30–60, гора 60–90; имя — ближе к кружку. */
const WH = 15;
const PU = 45;
const GO = 75;
const NAME = 106;
const R = 27;

type Side = 'bottom' | 'left' | 'top' | 'right';

/** Точка и поворот надписи: along — вдоль края по ходу чтения, depth — от края внутрь. */
function at(side: Side, along: number, depth: number): { x: number; y: number; rot: number } {
  switch (side) {
    case 'bottom':
      return { x: along, y: S - depth, rot: 0 };
    case 'top':
      return { x: along, y: depth, rot: 0 };
    case 'left':
      return { x: depth, y: S - along, rot: -90 };
    case 'right':
      return { x: S - depth, y: along, rot: 90 };
  }
}

/** Число на листе: дробь — через запятую (точка разделяет записи). */
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1).replace('.', ','));

/** Запись нарастающим итогом в клетку шириной w: шрифт ужимается, не влезло — старые записи уходят под «…». */
function chain(vals: number[], side: Side, along: number, depth: number, w: number, fs = 15): string {
  if (!vals.length) return '';
  const p = at(side, along, depth);
  const est = (s: string, f: number) => s.length * f * 0.54;
  let list = vals.map(fmt);
  let cut = false;
  let f = fs;
  const text = () => (cut ? '…' : '') + list.join('.');
  if (est(text(), f) > w) f = Math.max(10.5, (f * w) / est(text(), f));
  while (list.length > 1 && est(text(), f) > w) {
    list = list.slice(1);
    cut = true;
  }
  const head = (cut ? '…' : '') + list.slice(0, -1).map((x) => x + '.').join('');
  return `<text x="${p.x}" y="${p.y}" transform="rotate(${p.rot} ${p.x} ${p.y})" font-size="${f.toFixed(1)}">${esc(head)}<tspan class="pk-last">${esc(list[list.length - 1])}</tspan></text>`;
}

export interface PulkaSeat {
  seat: number;
  name: string;
  color: string;
}

/** Лист пульки (SVG). order — места по кругу, начиная со своего (снизу), дальше слева, (сверху), справа. */
export function pulkaSVG(v: View, order: PulkaSeat[]): string {
  const n = order.length;
  const sh = v.sheet;
  const sides: Side[] = n === 3 ? ['bottom', 'left', 'right'] : ['bottom', 'left', 'top', 'right'];
  const c = S / 2;
  let lines = '';
  // рамки полос
  for (const d of [0, 30, 60, 90]) lines += `<rect x="${d}" y="${d}" width="${S - 2 * d}" height="${S - 2 * d}" />`;
  // лучи от кружка
  const rays: [number, number][] = n === 3 ? [[0, S], [S, S], [c, 0]] : [[0, S], [S, S], [0, 0], [S, 0]];
  for (const [x, y] of rays) {
    const dx = x - c;
    const dy = y - c;
    const k = R / Math.hypot(dx, dy);
    lines += `<line x1="${c + dx * k}" y1="${c + dy * k}" x2="${x}" y2="${y}" />`;
  }
  // втроём: верхние углы срезаны до горы — там клетки вистов левого и правого друг на друга
  if (n === 3) lines += `<line x1="0" y1="0" x2="90" y2="90" /><line x1="${S}" y1="0" x2="${S - 90}" y2="90" />`;
  let text = '';
  const wh = (a: number, b: number) => sh.whists[order[a].seat][order[b].seat];
  if (n === 3) {
    // снизу: висты на левого и на правого
    lines += `<line x1="${c}" y1="${S}" x2="${c}" y2="${S - 30}" />`;
    text += chain(wh(0, 1), 'bottom', 90, WH, 116) + chain(wh(0, 2), 'bottom', 210, WH, 116);
    // слева: на нижнего — вдоль края, на правого — сверху слева; справа — наоборот
    text += chain(wh(1, 0), 'left', 150, WH, 232) + chain(wh(1, 2), 'top', 90, WH, 116);
    text += chain(wh(2, 0), 'right', 150, WH, 232) + chain(wh(2, 1), 'top', 210, WH, 116);
  } else {
    // вчетвером: клетка вистов делится на три — у соседа слева, напротив, у соседа справа (по ходу чтения)
    const slots: Record<Side, number[]> = { bottom: [1, 2, 3], left: [0, 3, 2], top: [1, 0, 3], right: [2, 1, 0] };
    sides.forEach((side, k) => {
      for (const a of [100, 200]) {
        const p = at(side, a, 0);
        const q = at(side, a, 30);
        lines += `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" />`;
      }
      slots[side].forEach((o, j) => (text += chain(wh(k, o), side, [65, 150, 235][j], WH, j === 1 ? 96 : 66, 13)));
    });
  }
  sides.forEach((side, k) => {
    const seat = order[k].seat;
    text += chain(sh.pulya[seat], side, c, PU, 176) + chain(sh.gora[seat], side, c, GO, 116);
    const p = at(side, c, NAME);
    text += `<text class="pk-name" x="${p.x}" y="${p.y}" transform="rotate(${p.rot} ${p.x} ${p.y})" fill="${order[k].color}">${esc(order[k].name)}</text>`;
  });
  const sk = v.cfg.variant === 'skachki';
  const mid = `<circle cx="${c}" cy="${c}" r="${R}" /><text class="pk-mid" x="${c}" y="${sk ? c - 5 : c}">${v.cfg.pulya}</text>${sk ? `<text class="pk-sk" x="${c}" y="${c + 12}">скак ${v.skak}</text>` : ''}`;
  return `<svg class="pk" viewBox="-2 -2 ${S + 4} ${S + 4}" role="img" aria-label="Пулька"><g class="pk-lines">${lines}</g>${mid}<g class="pk-ink">${text}</g></svg>`;
}
