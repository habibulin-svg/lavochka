import type { GameModule } from '../../core/view';
import { def } from './def';
import { createView, PREF_CAM } from './view';

const mod: GameModule = {
  def,
  createView,
  prefs: [{ key: PREF_CAM, label: 'Вид', hint: 'из-за руля — как сидишь за игрушкой', choices: [{ value: 'drive', label: 'из-за руля' }, { value: 'top', label: 'сверху' }], default: 'drive' }],
};
export default mod;
