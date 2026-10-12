/* «Электроника ИМ» — одна карточка на всю серию: настоящие прошивки КБ1013ВК1-2 (эмулятор SM5A) в корпусах по артворку. */
import type { ArcadeModule } from '../../core/arcade';
import { GAMES } from './games';
import { mountGw } from './player';

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'elektronika',
  title: 'Электроника ИМ',
  about: 'Советские ЖК-игры — настоящие прошивки, как на заводе: «Ну, погоди!», «Тайны океана», «Весёлый повар», «Автослалом» и другие.',
  controls: `<p>Мышью или пальцем — по кнопкам на корпусе.</p>
    <p>Четыре кнопки по углам: <kbd>Q</kbd> ↖, <kbd>A</kbd> ↙, <kbd>P</kbd> ↗, <kbd>L</kbd> ↘ (или стрелки, или 7/1/9/3 на цифровом блоке).</p>
    <p>Две кнопки: <kbd>←</kbd> <kbd>→</kbd>. «Автослалом»: <kbd>←</kbd> <kbd>→</kbd> руль, <kbd>↑</kbd> скорость, <kbd>Пробел</kbd> запуск.</p>
    <p><kbd>1</kbd> — игра А, <kbd>2</kbd> — игра Б, <kbd>3</kbd> — время. Прибор не выключается: часы и счёт сохраняются.</p>`,
  modes: GAMES.map((g) => ({ id: g.id, label: g.title, hint: g.model })),
  list: true,
  starts: [
    { id: 'a', label: 'Игра А' },
    { id: 'b', label: 'Игра Б' },
  ],
  noRecords: true,
  mount: (root, opts) => mountGw(GAMES.find((g) => g.id === opts.mode) ?? GAMES[0], root, opts),
};

export default mod;
