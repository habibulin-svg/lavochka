import type { GameModule } from '../../core/view';
import { def } from './def';
import { createView } from './view';

// словарь грузит каталог вместе с модулем (loadDict) — движку он нужен синхронно
const mod: GameModule = { def, createView };
export default mod;
