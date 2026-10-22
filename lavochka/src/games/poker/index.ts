import { dropSave, loadSave } from '../../core/session';
import type { GameModule } from '../../core/view';
import { LOOKS } from '../holdem/looks';
import { VIEW_PREF } from '../holdem/view';
import { def } from './def';
import { lobby } from './lobby';
import { createView } from './switch';

// партия, сохранённая до общего движка (без блайндов в настройках), уже не продолжится
if (loadSave(def.id) && !('blind' in (loadSave(def.id)!.options ?? {}))) dropSave(def.id);

const mod: GameModule = { def, createView, prefs: [VIEW_PREF], looks: LOOKS, home: lobby };
export default mod;
