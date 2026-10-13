/* Разведка «Шёл солдата»: партия ботов на поле и первые шаги с печатью состояния.
 * Запуск из lavochka/:  npx tsx tools/hodilki/shel-probe.ts [ходов] */
import { SeededRng } from '../../src/core/rng';
import { simulate } from '../../tests/harness';
import { def, boardOf } from '../../src/games/hodilki/def';

const seats = [0, 1].map((seat) => ({ seat, kind: 'bot' as const, name: def.seats[seat].name, level: 2 }));
const b = boardOf('shel');

async function main() {
  const r = await simulate(def, seats, { map: 'shel' }, 7, Number(process.argv[2] ?? 4000));
  console.log('партия:', JSON.stringify(r));
  console.log('клеток всего', b.cells.length, 'лента', b.end, 'ярмарки', b.deck!.market.join(','));
  console.log('запас на двоих:', JSON.stringify(b.deck!.stock.bread), b.deck!.cards.length, 'видов');
}

void main();
