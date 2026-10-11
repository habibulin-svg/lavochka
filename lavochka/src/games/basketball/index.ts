import type { GameModule } from '../../core/view';
import { def } from './def';
import { createView, PREF_CAM } from './view';

const mod: GameModule = {
  def,
  createView,
  prefs: [{ key: PREF_CAM, label: 'Вид', hint: 'спереди — как на фото коробки', choices: [{ value: 'side', label: 'спереди' }, { value: 'end', label: 'со своего торца' }], default: 'side' }],
};
export default mod;
