import type { GameModule } from '../../core/view';
import { def } from './def';
import { createView } from './view';
import './dvor.css';

const mod: GameModule = { def, createView };
export default mod;
