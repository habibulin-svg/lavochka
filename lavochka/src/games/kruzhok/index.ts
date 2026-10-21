/* Шахматный кружок — учебник, задачи, разбор партий и энциклопедия в одном модуле (план — docs/analysis/chess-kruzhok.md).
 * Свой экран (рамка аркады): разделы — режимы, справа — карточка раздела. Доска и правила — из games/chess,
 * движок для разбора — Stockfish в браузере (chess/stockfish.ts). */
import type { ArcadeModule } from '../../core/arcade';
import { stockfish } from '../chess/stockfish';
import { mountAnalysis } from './analysis';
import { mountJournal } from './journal';
import { mountTrainer } from './trainer';
import './kruzhok.css';

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'kruzhok',
  title: 'Шахматный кружок',
  about: 'Кружок при дворе: задачи с рейтингом и разрядами, разбор позиций движком, а дальше — учебник, классические партии и энциклопедия.',
  controls: `<p>Ход — нажмите на фигуру, потом на подсвеченное поле. В разборе ← → листают ходы.</p>
    <p><b>Задачи</b> подбираются под ваш рейтинг; неверный ход можно вернуть — движок покажет, чем он плох. Рейтинг меняется только за первую попытку, подсказка — задача не в зачёт.</p>`,
  modes: [
    { id: 'zadachi', label: 'Задачи', hint: 'решать по рейтингу или по теме' },
    { id: 'razbor', label: 'Разбор', hint: 'доска с движком' },
    { id: 'zhurnal', label: 'Журнал', hint: 'разряд, рейтинг, успехи' },
  ],
  noRecords: true,
  mount: (root, opts) => {
    const panel = opts.panel ?? document.createElement('div');
    root.classList.add('kz-stage');
    let sub: { destroy(): void };
    const open = (mode: string) => {
      sub =
        mode === 'razbor'
          ? mountAnalysis(root, panel)
          : mode === 'zhurnal'
            ? mountJournal(root, panel, () => {
                sub.destroy();
                open('zhurnal');
              })
            : mountTrainer(root, panel);
    };
    open(opts.mode);
    return {
      destroy() {
        sub.destroy();
        stockfish.quit();
        root.classList.remove('kz-stage');
      },
    };
  },
};

export default mod;
