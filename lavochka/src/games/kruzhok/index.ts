/* Шахматный кружок — учебник, задачи, разбор партий и энциклопедия в одном модуле (план — docs/analysis/chess-kruzhok.md).
 * Свой экран (рамка аркады): разделы — режимы, справа — карточка раздела. Доска и правила — из games/chess,
 * движок для разбора — Stockfish в браузере (chess/stockfish.ts). */
import type { ArcadeModule } from '../../core/arcade';
import { stockfish } from '../chess/stockfish';
import { mountAnalysis } from './analysis';
import { mountJournal } from './journal';
import { mountClassics } from './partii';
import { mountLessons } from './lessons';
import { mountEncyclopedia } from './encyclopedia';
import { mountTrainer } from './trainer';
import './kruzhok.css';

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'kruzhok',
  title: 'Шахматный кружок',
  about: 'Кружок при дворе: учебник от правил до стратегии, задачи с рейтингом и разрядами, классические партии с вопросом «А как сходил бы ты?», энциклопедия дебютов и терминов, разбор позиций движком.',
  controls: `<p>Ход — нажмите на фигуру, потом на подсвеченное поле. В разборе ← → листают ходы.</p>
    <p><b>Задачи</b> подбираются под ваш рейтинг; неверный ход можно вернуть — движок покажет, чем он плох. Рейтинг меняется только за первую попытку, подсказка — задача не в зачёт.</p>
    <p><b>Партии</b> листаются ▶ или →; в ключевых местах доска ждёт ваш ход — «А как сходил бы ты?». Вопросы можно выключить галочкой.</p>`,
  modes: [
    { id: 'zadachi', label: 'Задачи', hint: 'решать по рейтингу или по теме' },
    { id: 'uchebnik', label: 'Учебник', hint: 'от правил до стратегии, шаг за шагом' },
    { id: 'partii', label: 'Партии', hint: 'классика: «А как сходил бы ты?»' },
    { id: 'razbor', label: 'Разбор', hint: 'доска с движком' },
    { id: 'enciklopediya', label: 'Энциклопедия', hint: 'дебюты и термины' },
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
          : mode === 'partii'
            ? mountClassics(root, panel)
            : mode === 'uchebnik'
              ? mountLessons(root, panel)
              : mode === 'enciklopediya'
                ? mountEncyclopedia(root, panel)
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
