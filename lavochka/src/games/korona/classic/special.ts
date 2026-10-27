/**
 * «Корона Эмбера», «Классика 1994» — особые правила, написанные кодом: операции `special` в сценариях карт и клеток,
 * обработчики хода (бросок на ход, перед ходом, подполя, поле 2) и ответы на особые вопросы (`answer:<kind>`).
 */
import type { Op } from './script';
import type { CState, Frame, Prompt } from './state';
import type { X } from './engine';

export type SpecialFn = (s: CState, x: X, seat: number, op: Extract<Op, { t: 'special' }>, f: Frame, p?: Prompt, key?: string) => void;
export const SPECIAL: Record<string, SpecialFn> = {};
