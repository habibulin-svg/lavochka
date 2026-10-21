/* Общее для сетевых режимов аркад («Яйца динозавров», «Шарики», «Клад»): места до десяти, режимы, подписи. Без DOM. */
import type { OptionDef, Preset, SeatLook } from './types';

export const VS_SEATS: SeatLook[] = [
  { name: 'Вовка', color: '#c0281e', light: '#e86a5a', dark: '#7a140e' },
  { name: 'Ленка', color: '#23408f', light: '#5a78c8', dark: '#122450' },
  { name: 'Серёга', color: '#2a7a3a', light: '#5aaa6a', dark: '#164a20' },
  { name: 'Танька', color: '#8a5a10', light: '#c8964a', dark: '#4a3008' },
  { name: 'Димка', color: '#7a2a8a', light: '#b06ac0', dark: '#40104a' },
  { name: 'Олька', color: '#c05a10', light: '#e8945a', dark: '#6a3008' },
  { name: 'Лёха', color: '#1a7a7a', light: '#5ab0b0', dark: '#0a4040' },
  { name: 'Маринка', color: '#b0306a', light: '#e070a0', dark: '#601838' },
  { name: 'Костик', color: '#4a5a1a', light: '#8a9a5a', dark: '#2a3008' },
  { name: 'Светка', color: '#3a3a9a', light: '#7a7ad0', dark: '#1a1a50' },
];

export const VS_MODE: OptionDef = {
  key: 'mode',
  label: 'Режим',
  type: 'select',
  choices: [
    { value: 'duel', label: 'Дуэль 1 на 1' },
    { value: 'battle', label: 'Битва до 10' },
  ],
  default: 'duel',
};

export const VS_PRESETS: Preset[] = [
  { id: 'duel', label: 'Дуэль 1 на 1', hint: 'Своё поле и поле соперника рядом', options: { mode: 'duel' } },
  { id: 'battle', label: 'Битва до 10', hint: 'Кто останется последним', options: { mode: 'battle' } },
];

export const vsCounts = (o: Record<string, unknown>) => (o.mode === 'battle' ? [3, 4, 5, 6, 7, 8, 9, 10] : [2]);
export const vsCountsHint = (o: Record<string, unknown>) => (o.mode === 'battle' ? 'битва — от трёх до десяти' : 'дуэль — вдвоём');
export const rowsWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? '' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'а' : 'ов');
