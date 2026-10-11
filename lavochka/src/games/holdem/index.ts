import type { GameModule } from '../../core/view';
import { def } from './def';
import { createView, VIEW_PREF } from './view';

const mod: GameModule = { def, createView, prefs: [VIEW_PREF] };
export default mod;
