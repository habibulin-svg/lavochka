/* Игровые автоматы «15 копеек» — одна карточка на все: советские микропроцессорные автоматы по образам MAME
 * (ТИА-МЦ-1, «Фотон», «Фотон ИК-2»), в корпусе по снимку настоящего автомата. Пробел — бросить монету. */
import type { ArcadeModule } from '../../core/arcade';
import { GAMES } from './games';
import { mountMorboy } from './morboy/view';
import { mountAuto } from './player';

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'avtomaty',
  title: 'Игровые автоматы',
  about: 'Советские игровые автоматы за 15 копеек — настоящие программы плат ТИА-МЦ-1 и «Фотон»: «Конёк-Горбунок», «S.O.S.», «Снежная королева», «Тетрис», «Чёрный корабль» и другие.',
  controls: `<p><kbd>Пробел</kbd> — бросить монету 15 коп. (или щелчок по монетоприёмнику). Пока игра идёт, автомат монету не берёт — она вернётся в лоток.</p>
    <p>Ручка — стрелки или <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>; кнопки — <kbd>Z</kbd> (или <kbd>Ctrl</kbd>) и <kbd>X</kbd> (или <kbd>Shift</kbd>). На телефоне — пальцем по ручке и кнопкам на пульте.</p>
    <p>«Городки»: стрелки ← → крутят ручку прицела. «Фотон» — только ручка; «Фотон ИК-2»: монета покупает 6 минут игры.</p>
    <p>«Морской бой»: перископ — стрелки ← → или тащить мышью/пальцем по окуляру; «ПУСК» — <kbd>Z</kbd>, <kbd>Enter</kbd> или красная кнопка на правой рукоятке. Целиться средним визиром с упреждением.</p>
    <p>Монеты: «строго» — рубль на день, шесть монет; «бесконечные» — сколько угодно.</p>`,
  modes: GAMES.map((g) => ({ id: g.id, label: g.title, hint: g.board })),
  list: true,
  starts: [{ id: 'coin', label: 'Бросить 15 коп.' }],
  noRecords: true,
  mount: (root, opts) => {
    const g = GAMES.find((x) => x.id === opts.mode) ?? GAMES[0];
    return g.kind === 'morboy' ? mountMorboy(root, opts) : mountAuto(g, root, opts);
  },
};

export default mod;
