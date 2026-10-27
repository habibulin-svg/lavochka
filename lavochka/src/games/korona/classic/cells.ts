/**
 * «Корона Эмбера», «Классика 1994» — условия клеток поля 1 сценариями (тексты — data/field1.json, дословно с поля).
 * Номера клеток — как в разметке `korona/data.json`.
 */
import type { Op } from './script';

/** Порог Провала по полю: Мир Магии — 11, Силы — 12, Ума — 13 (по всем ПС, ПУ, ПМ, ПО; без друзей и предметов). */
export const FALL_NEED = { 31: 11, 54: 12, 22: 13, min: 11 } as const;

export type CellKind = 'exchange' | 'hospital' | 'office' | 'fall' | 'police' | 'shop' | 'door' | 'plain';
export function cellKind(n: number): CellKind {
  if (n === 1 || n === 2) return 'exchange';
  if (n === 18) return 'hospital';
  if (n === 52) return 'office';
  if (n === 22 || n === 31 || n === 54) return 'fall';
  if (n === 77) return 'police';
  if ([15, 19, 23, 44, 45].includes(n)) return 'shop';
  if (n === 26 || n === 29) return 'door';
  return 'plain';
}

const d = (n: number): Op => ({ t: 'draw', n });
const r = (lo: number, hi: number, ops: Op[]) => ({ r: [lo, hi] as [number, number], ops });
const roll = (...br: ReturnType<typeof r>[]): Op => ({ t: 'roll', br });
const roll2 = (...br: ReturnType<typeof r>[]): Op => ({ t: 'roll', dice: 2, br });
const add = (p: Op & { t: 'add' } extends infer A ? A extends { p: infer P } ? P : never : never, n: number): Op => ({ t: 'add', p, n });
const sp = (id: string, n?: number): Op => ({ t: 'special', id, n });
const conv = (fp: 'ПС' | 'ПУ' | 'ПМ' | 'ПЖ', fn: number, tp: 'ПС' | 'ПУ' | 'ПМ' | 'ПЖ', tn: number, orElse?: Op[]): Op => ({ t: 'convert', from: [fp, fn], to: [tp, tn], else: orElse });
const go = (cell: string): Op => ({ t: 'move', to: { cell }, cond: true });

export const CELL_OPS: Record<number, Op[]> = {
  1: [sp('exchange', 1)],
  2: [sp('exchange', 2)],
  3: [
    roll(
      r(1, 1, [{ t: 'gain', item: 'запечатанная бутылка' }]),
      r(2, 2, [{ t: 'choice', q: 'Обменять 1 ПС и 1 ПМ на 1 ПЖ?', opts: [{ label: 'Обменять', ops: [sp('innSwap')], if: { all: [{ pts: 'ПС', min: 1 }, { pts: 'ПМ', min: 1 }] } }, { label: 'Нет', ops: [] }] }]),
      r(3, 3, [sp('changeTraveller')]),
      r(4, 4, [go('Зачарованная деревня')]),
      r(5, 5, [go('Храм Бааля')]),
      r(6, 6, [add('ПС', 1), add('ПЖ', 1)]),
    ),
  ],
  4: [roll(r(1, 3, [d(1)]), r(4, 6, [d(2)]))],
  5: [
    { t: 'if', c: { align: 'добрый' }, then: [add('ПЖ', 1)] },
    { t: 'if', c: { align: 'нейтральный' }, then: [{ t: 'choice', q: 'Отдать 1 ПС, 1 ПУ, 1 ПМ и стать добрым?', opts: [{ label: 'Стать добрым', ops: [add('ПС', -1), add('ПУ', -1), add('ПМ', -1), { t: 'align', to: 'добрый' }], if: { all: [{ pts: 'ПС', min: 1 }, { pts: 'ПУ', min: 1 }, { pts: 'ПМ', min: 1 }] } }, { label: 'Нет', ops: [] }] }] },
    { t: 'if', c: { align: 'злой' }, then: [add('ПМ', -1)] },
    d(1),
  ],
  6: [d(1)], // уходя — −1 к броску (moveRoll)
  7: [d(1)], // злые здесь беспечны и могут отразить карту (special evilForest в drawCards)
  8: [sp('lyceum')],
  9: [d(1)],
  10: [roll(r(1, 1, [{ t: 'skip', n: 1 }, sp('later', 3)]), r(2, 3, [d(2)]), r(4, 6, [d(1)]))],
  11: [d(1)],
  12: [d(2)],
  14: [d(2)],
  15: [{ t: 'shop' }, d(1)],
  16: [roll(r(1, 2, [d(1)]), r(3, 4, [d(2)]), r(5, 5, [d(3)]), r(6, 6, [add('т', 10)]))],
  17: [
    roll(
      r(1, 1, [{ t: 'gain', item: 'бутылка виски' }]),
      r(2, 2, [add('ПС', -1)]),
      r(3, 3, [{ t: 'gain', item: 'патрон с серебряной пулей' }]),
      r(4, 4, [sp('vaquero')]),
      r(5, 5, [add('ПЖ', -1)]),
      r(6, 6, [{ t: 'skip', n: 1 }]),
    ),
  ],
  18: [sp('hospital')],
  19: [{ t: 'shop' }, d(1)],
  20: [roll(r(1, 5, [d(2)]), r(6, 6, [add('т', 15)]))],
  21: [roll(r(1, 4, [d(1)]), r(5, 5, [sp('repairOrLose', 2)]), r(6, 6, [sp('horseCure', 3)]))],
  22: [sp('fall', 22)],
  23: [{ t: 'shop' }, d(1)],
  24: [roll(r(1, 4, [d(1)]), r(5, 6, [conv('ПЖ', 1, 'ПУ', 1)]))],
  27: [d(2)],
  30: [roll(r(1, 3, [d(1)]), r(4, 6, [sp('olympus')]))],
  31: [sp('fall', 31)],
  32: [d(2)],
  33: [d(1)],
  34: [roll(r(1, 1, [conv('ПУ', 2, 'ПС', 1)]), r(2, 2, [conv('ПС', 2, 'ПУ', 1)]), r(3, 3, [conv('ПМ', 2, 'ПУ', 1)]), r(4, 4, [add('ПУ', -2)]), r(5, 5, [add('ПМ', -2)]), r(6, 6, [add('ПС', -2)]))],
  35: [d(2)],
  36: [{ t: 'choice', q: 'Заплатить 5 талеров, взять 3 карты и выбрать 1?', opts: [{ label: 'Заплатить 5 т', ops: [add('т', -5), sp('pickOf', 3)], if: { pts: 'т', min: 5 } }, { label: 'Взять 1 карту', ops: [d(1)] }] }],
  37: [sp('dice', 37)],
  38: [d(1)], // владыка Мира Магии беспечен (special lordCell в drawCards)
  39: [roll(r(1, 4, [d(1)]), r(5, 6, [conv('ПС', 2, 'ПУ', 1, [add('ПЖ', -1)])]))],
  41: [d(1)], // предметы, магические предметы и амулеты здесь не действуют (бой)
  42: [d(1)], // уходя — бросок 5-6: Покинутый дом (moveRoll)
  44: [{ t: 'shop' }, d(1)],
  45: [{ t: 'shop' }, d(1)],
  46: [sp('dice', 46)],
  47: [sp('smugglers')],
  48: [roll(r(1, 2, [d(1)]), r(3, 4, [d(2)]), r(5, 6, [conv('ПУ', 2, 'ПМ', 1)]))],
  49: [d(1)],
  50: [d(2)],
  51: [roll(r(1, 5, [d(1)]), r(6, 6, [{ t: 'skip', n: 1 }, sp('later', 2)]))],
  52: [sp('office')],
  53: [d(1)],
  54: [sp('fall', 54)],
  55: [roll(r(1, 1, [add('ПЖ', -1)]), r(2, 2, [add('ПС', -1)]), r(3, 3, [{ t: 'lose', what: 'item' }]), r(4, 4, [add('ПС', 2)]), r(5, 5, [add('ПЖ', 2)]), r(6, 6, [add('ПС', 1)]))],
  56: [roll(r(1, 1, [{ t: 'skip', n: 1 }]), r(2, 2, [add('ПУ', -2)]), r(3, 4, [d(1)]), r(5, 6, [d(2)]))],
  57: [sp('dice', 57)],
  58: [sp('legion')],
  59: [roll(r(1, 1, [add('ПЖ', -3)]), r(2, 2, [{ t: 'lose', what: 'amulets' }]), r(3, 3, [add('ПМ', -3)]), r(4, 4, [add('ПМ', 1)]), r(5, 5, [add('ПЖ', 1)]), r(6, 6, [{ t: 'gain', item: 'амулет №1' }]))],
  60: [roll(r(1, 1, [d(1)]), r(2, 4, [d(2)]), r(5, 5, [{ t: 'lose', what: 'horse', else: [] }]), r(6, 6, [{ t: 'lose', what: 'item', else: [] }]))],
  61: [d(2)],
  62: [d(1)], // уходя — без лошади (moveRoll)
  63: [roll(r(1, 2, [d(1)]), r(3, 4, [d(2)]), r(5, 6, [d(3)]))],
  64: [roll(r(1, 5, [d(1)]), r(6, 6, [{ t: 'choice', q: 'Сорвать плод мудрости?', opts: [{ label: 'Сорвать (+1 ПУ)', ops: [add('ПУ', 1)] }, { label: 'Нет', ops: [] }] }]))],
  65: [d(1)],
  66: [d(2)],
  67: [d(1)],
  68: [roll(r(1, 1, [add('ПУ', 1)]), r(2, 2, [add('ПУ', 2)]), r(3, 3, [add('ПУ', 1), add('ПМ', 1)]), r(4, 4, [add('ПУ', -1)]), r(5, 5, [add('ПУ', -1), { t: 'skip', n: 1 }]), r(6, 6, [conv('ПУ', 2, 'ПС', 1)]))],
  69: [sp('dice', 69)],
  70: [sp('airport')],
  71: [sp('usurer')],
  72: [sp('dice', 72)],
  73: [sp('rob', 73)],
  74: [sp('detective')],
  75: [sp('dice', 75)],
  76: [sp('dice', 76)],
  77: [
    roll(
      r(1, 1, [sp('fine', 10)]),
      r(2, 2, [sp('fine', 15)]),
      r(3, 3, [add('ПС', -1)]),
      r(4, 4, [{ t: 'skip', n: 1 }]),
      r(5, 5, [{ t: 'gain', item: 'жетон детектива 2-го класса' }]),
      r(6, 6, [{ t: 'gain', item: 'жетон детектива 1-го класса' }]),
    ),
  ],
  78: [sp('rob', 78)],
  79: [sp('exchangeMarket')],
  80: [sp('dice', 80)],
  81: [sp('treasureCave')],
};

/** Лицей — два кубика по таблице с поля. */
export const LYCEUM: Record<number, Op[]> = {
  2: [add('ПС', -2)],
  3: [{ t: 'zero', p: 'ПУ' }],
  4: [{ t: 'skip', n: 1 }, sp('lyceumAgain')],
  5: [add('ПУ', -2)],
  6: [add('ПУ', -2), add('ПМ', -2)],
  7: [add('ПС', -1), add('ПУ', -1), add('ПМ', -1)],
  8: [add('ПУ', 2)],
  9: [add('ПУ', 2), add('ПМ', 1)],
  10: [add('ПУ', 2), add('ПМ', 2)],
  11: [add('ПС', 2), add('ПУ', 2), add('ПМ', 2)],
  12: [add('ПС', 2), add('ПУ', 2), add('ПМ', 2), { t: 'gain', item: 'золотая сова' }],
};
void roll2;
