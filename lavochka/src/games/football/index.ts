import type { GameModule } from '../../core/view';
import { def } from './def';
import { createView, PREF_CAM } from './view';

const mod: GameModule = {
  def,
  createView,
  prefs: [{ key: PREF_CAM, label: 'Вид', hint: 'спереди — как сидишь за длинной стороной подноса', choices: [{ value: 'side', label: 'спереди' }, { value: 'end', label: 'из-за ворот' }], default: 'side' }],
};
export default mod;
