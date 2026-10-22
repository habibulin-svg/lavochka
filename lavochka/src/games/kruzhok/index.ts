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
import { MODES, parseKruzhok } from './pages';
import { onStars } from './path';
import { syncKruzhok } from './cloud';
import { mountPut } from './put';
import { mountThumb } from './thumb';
import { mountStorm } from './storm';
import { Sound } from '../../core/audio';
import './kruzhok.css';

/** «Разобрать в кружке» из «Шахмат»: ходы партии в адресе (?hody=e2e4-e7e5-…). */
function gameFromUrl() {
  const raw = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('hody') : null;
  const moves = raw?.split('-').filter((u) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)).slice(0, 600);
  return moves?.length ? { moves, note: 'Твоя партия из «Шахмат». Листай ходы стрелками ◀ ▶: где оценка резко прыгнула — там ошибка, а движок покажет, как было лучше.' } : {};
}

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'kruzhok',
  title: 'Шахматный кружок',
  about: 'Кружок при дворе: учебник от правил до стратегии, задачи с рейтингом и разрядами, классические партии с вопросом «А как сходил бы ты?», энциклопедия дебютов и терминов, разбор позиций движком.',
  controls: `<p>Ход — нажмите на фигуру, потом на подсвеченное поле. В разборе ← → листают ходы.</p>
    <p><b>Задачи</b> подбираются под ваш рейтинг; неверный ход можно вернуть — движок покажет, чем он плох. Рейтинг меняется только за первую попытку, подсказка — задача не в зачёт.</p>
    <p><b>Партии</b> листаются ▶ или →; в ключевых местах доска ждёт ваш ход — «А как сходил бы ты?». Вопросы можно выключить галочкой.</p>`,
  modes: MODES.map(({ id, label, hint }) => ({ id, label, hint })),
  noRecords: true,
  // открыли кружок — сначала «Путь»: что здесь есть и с чего начать
  home: 'put',
  thumb: mountThumb,
  mount: (root, opts) => {
    const panel = opts.panel ?? document.createElement('div');
    root.classList.add('kz-stage');
    let sub: { destroy(): void };
    // открыли адресом урока, партии или дебюта — сразу туда (только при первом показе раздела)
    const at = typeof location !== 'undefined' ? parseKruzhok(location.pathname) : null;
    let deep = at && at.mode === opts.mode ? at.sub : undefined;
    const open = (mode: string) => {
      const start = deep;
      deep = undefined;
      sub =
        mode === 'razbor'
          ? mountAnalysis(root, panel, gameFromUrl())
          : mode === 'partii'
            ? mountClassics(root, panel, start)
            : mode === 'uchebnik'
              ? mountLessons(root, panel, start)
              : mode === 'enciklopediya'
                ? mountEncyclopedia(root, panel, start)
          : mode === 'put'
            ? mountPut(root, panel)
          : mode === 'shturm'
            ? mountStorm(root, panel)
          : mode === 'zhurnal'
            ? mountJournal(root, panel, () => {
                sub.destroy();
                open('zhurnal');
              })
            : mountTrainer(root, panel);
    };
    open(opts.mode);
    // вошедший: журнал из базы, если там новее (занимался на другом устройстве) — раздел заново, с ним
    let alive = true;
    void syncKruzhok().then((changed) => {
      if (!changed || !alive) return;
      sub.destroy();
      open(opts.mode);
    });
    // звёзды кружка — всплывающее «+N ⭐» поверх сцены, где бы ни заработал
    const off = onStars((n, why) => {
      const f = document.createElement('div');
      f.className = 'kz-stars';
      f.innerHTML = `+${n} ⭐<small>${why}</small>`;
      root.appendChild(f);
      if (n >= 10) Sound.win();
      setTimeout(() => f.remove(), 2200);
    });
    return {
      destroy() {
        alive = false;
        off();
        sub.destroy();
        stockfish.quit();
        root.classList.remove('kz-stage');
      },
    };
  },
};

export default mod;
