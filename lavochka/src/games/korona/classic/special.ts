/**
 * «Корона Эмбера», «Классика 1994» — особые правила, написанные кодом: операции `special` в сценариях карт и клеток,
 * обработчики хода (бросок на ход, перед ходом, подполя, поле 2) и ответы на особые вопросы (`answer:<kind>`).
 * Сама таблица — в `special-base.ts`; здесь только подключение модулей, которые в неё пишут.
 */
export { SPECIAL } from './special-base';
export type { SpecialFn } from './special-base';
import './special-turn';
import './special-cards1';
import './special-cards2';
import './special-field2';
import './special-pvp';
