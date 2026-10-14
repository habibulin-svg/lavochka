/* Роспись — таблица, как её чертят в тетради перед игрой: строка на каждую сдачу расписания (по скольку карт, особые — буквой),
 * у каждого игрока два столбца — заказ и очки нарастающим итогом. Заказ пишут карандашом, пока сдача идёт; сыгранную — ручкой:
 * недобор — красным, перебор — бледно. Блоки расписания разделены жирной чертой, внизу — итог. */
import { esc } from '../../core/util';
import { KIND_NAME, type Kind, type View } from './engine';

const LETTER: Partial<Record<Kind, string>> = { dark: 'Т', nt: 'Б', gold: 'З', misere: 'М', lob: 'Л' };

export interface RospisSeat {
  seat: number;
  name: string;
  color: string;
}

export function rospisHTML(v: View, seats: RospisSeat[]): string {
  const tot = Array(6).fill(0);
  const head = seats.map((x) => `<th colspan="2" style="color:${x.color}">${esc(x.name)}</th>`).join('');
  let body = '';
  v.plan.forEach((d, i) => {
    const row = v.rows[i];
    const now = !row && i === v.deal && v.phase !== 'over';
    const blk = i > 0 && v.plan[i - 1].kind !== d.kind ? ' blk' : '';
    const label = `${LETTER[d.kind] ?? ''}${d.cards}`;
    let cells = '';
    for (const x of seats) {
      const p = x.seat;
      if (row) {
        tot[p] += row.add[p];
        const b = row.bids[p];
        const res = row.add[p] < 0 ? ' minus' : b != null && row.took[p] > b ? ' over' : '';
        cells += `<td class="rs-b">${b == null ? '' : b || '–'}</td><td class="rs-p${res}" title="${row.add[p] > 0 ? '+' : ''}${row.add[p]} · взял ${row.took[p]}">${tot[p]}</td>`;
      } else if (now) {
        const b = v.bids[p];
        cells += `<td class="rs-b pencil">${b == null ? '' : b || '–'}</td><td class="rs-p"></td>`;
      } else cells += '<td class="rs-b"></td><td class="rs-p"></td>';
    }
    body += `<tr class="${now ? 'cur' : row ? 'done' : 'todo'}${blk}"><td class="rs-n" title="${KIND_NAME[d.kind]}, по ${d.cards}">${label}</td>${cells}</tr>`;
  });
  const sum = seats.map((x) => `<td colspan="2">${v.score[x.seat]}</td>`).join('');
  return `<div class="rs-wrap"><table class="rs"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody><tfoot><tr><td>итог</td>${sum}</tr></tfoot></table></div>`;
}
