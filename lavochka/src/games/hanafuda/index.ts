import type { GameModule } from '../../core/view';
import { def } from './def';
import { HF_PREFS, createView } from './view';

const mod: GameModule = { def, createView, prefs: HF_PREFS };
export default mod;
