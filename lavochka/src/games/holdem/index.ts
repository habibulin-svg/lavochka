import type { GameModule } from '../../core/view';
import { def } from './def';
import { LOOKS } from './looks';
import { createView, VIEW_PREF } from './view';

const mod: GameModule = { def, createView, prefs: [VIEW_PREF], looks: LOOKS };
export default mod;
