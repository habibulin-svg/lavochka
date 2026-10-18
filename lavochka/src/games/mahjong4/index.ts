import type { GameModule } from '../../core/view';
import { MJ_PREFS } from '../mahjong/draw';
import { def } from './def';
import { createView } from './view';

const mod: GameModule = { def, createView, prefs: MJ_PREFS };
export default mod;
