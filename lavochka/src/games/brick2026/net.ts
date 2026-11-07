/* Brick Game 2026 по сети и с ботами: дуэль и битва до шестнадцати за общим столом (чат, голос — от стола). */
import type { GameModule } from '../../core/view';
import { def } from './def';
import { createView } from './netview';

const mod: GameModule = { def, createView };
export default mod;
