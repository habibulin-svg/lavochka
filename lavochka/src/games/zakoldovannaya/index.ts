import { startLocal } from '../../core/session';
import type { GameModule } from '../../core/view';
import { def } from './def';
import { savesHome } from './ui/saves';
import { createView } from './view';

const mod: GameModule = {
  def,
  createView,
  // слоты сохранений — над «Новой партией»; автосохранение («Продолжить») ведёт ядро
  home: (box) => savesHome(box, (snap) => startLocal(mod, snap.seats, snap.options, snap)),
  prefs: [
    { key: 'zs.look', label: 'Вид', hint: 'тонировка портретов и планов или оригинальные ч/б картинки 1990 года', choices: [{ value: 'color', label: 'цветной' }, { value: 'orig', label: 'как в 1990-м' }], default: 'color' },
    { key: 'zs.music', label: 'Музыка', choices: [{ value: 'on', label: 'играет' }, { value: 'off', label: 'выключена' }], default: 'on' },
  ],
};
export default mod;
