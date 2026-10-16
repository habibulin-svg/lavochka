import type { GameModule } from '../../core/view';
import { def } from './def';
import { createView } from './view';

const mod: GameModule = {
  def,
  createView,
  // предупреждение 18+ — на экране настройки, до начала партии
  home(box) {
    box.innerHTML = `<div class="cah-warn"><b>18+</b> Игра для взрослых: на картах мат, секс, наркотики, смерть, политика и чёрный юмор обо всём.
      Тексты — официальная русская версия Cards Against Humanity, без цензуры.</div>`;
  },
};
export default mod;
