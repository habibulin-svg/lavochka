/**
 * Таблица особых правил — отдельным листовым модулем (без импортов кода), чтобы модули `special-*` и движок
 * могли регистрироваться в любом порядке загрузки, несмотря на циклические импорты.
 */
import type { Op } from './script';
import type { CState, Frame, Prompt } from './state';
import type { X } from './engine';

export type SpecialFn = (s: CState, x: X, seat: number, op: Extract<Op, { t: 'special' }>, f: Frame, p?: Prompt, key?: string) => void;
export const SPECIAL: Record<string, SpecialFn> = {};
