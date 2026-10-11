import type { GameModule } from '../../core/view';
import { def } from './def';
import { createView, PREF_CAM, PREF_GOALIE, PREF_MOUSE } from './view';

const mod: GameModule = {
  def,
  createView,
  prefs: [
    { key: PREF_CAM, label: 'Вид', hint: 'из-за своих ворот — как сидишь за настоящим', choices: [{ value: 'end', label: 'из-за ворот' }, { value: 'side', label: 'сбоку' }], default: 'end' },
    { key: PREF_MOUSE, label: 'Крутить мышью', choices: [{ value: 'drag', label: 'поперёк прорези' }, { value: 'wheel', label: 'колёсиком' }], default: 'drag' },
    { key: PREF_GOALIE, label: 'Вратарь', hint: 'WASD — сам ведёшь; пока не тронул — стоит сам', choices: [{ value: 'wasd', label: 'WASD' }, { value: 'auto', label: 'сам' }], default: 'wasd' },
  ],
};
export default mod;
