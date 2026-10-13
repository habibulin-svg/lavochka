import type { GameDef, Rng } from '../../core/types';
import { SEATS } from '../hodilki/core';
import { NEIGH, TO_FINISH, apply, describe, newState, toAct, view, type Action, type Event, type State } from './engine';

export const SEATS_LOCAL = SEATS.slice(0, 6);

/** Куда идти боту: поближе к устью Дона. */
export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.winner != null) return null;
  if (s.phase === 'roll') return { type: 'roll' };
  if (s.phase !== 'move' || s.left <= 0) return { type: 'stay' };
  const ns = NEIGH[s.pos[seat]];
  if (!ns.length) return { type: 'stay' };
  if (level === 0 && rng.int(3) === 0) return { type: 'step', to: ns[rng.int(ns.length)] };
  let pick = ns[0];
  let best = TO_FINISH[pick] < 0 ? 9999 : TO_FINISH[pick];
  for (const n of ns) {
    const d = TO_FINISH[n] < 0 ? 9999 : TO_FINISH[n];
    if (d < best) {
      best = d;
      pick = n;
    }
  }
  return { type: 'step', to: pick };
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'beglye',
  title: 'Беглые, или Вот тебе, бабушка, и Юрьев день',
  players: { min: 2, max: 6, default: 3 },
  seats: SEATS_LOCAL,
  options: [],
  presets: [{ id: 'classic', label: 'По правилам', options: {} }],
  setup: (seats) => newState(seats.map((x) => x.seat).sort((a, b) => a - b)),
  apply,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,
  toAct,
  view,
  result: (s) =>
    s.winner == null
      ? null
      : { winners: [s.winner], text: `${SEATS_LOCAL[s.winner]?.name ?? s.winner} дошёл до устья Дона первым — воля!` },
  showcase: () => {
    const s = newState([0, 1, 2]);
    s.pos[0] = 12;
    s.pos[1] = 200;
    s.pos[2] = 350;
    s.phase = 'roll';
    return s;
  },
  rules: {
    goal: 'Первым дойти до устья Дона: фигурки крестьян бегут из Кирилло-Белозерского монастыря по дорогам, а кубик со знаками то помогает, то сажает в острог.',
    sections: [
      {
        title: 'Кубик со знаками',
        html: `<p>Обычный ход — <b>на один пункт</b>, но перед каждым ходом бросают кубик, на гранях которого те же условные
          знаки, что и у пунктов на карте. Если знак на кубике совпал со знаком пункта, где стоит фигурка, случается то,
          что написано в легенде: лошадь — два пункта, лодка — вниз по течению, арест, плен, острог, гибель.</p>
          <p>Две особые грани — <b>«Побег»</b> и <b>«Юрьев день»</b>: только с ними можно выйти из монастыря и от помещика,
          а «Побег» ещё и выпускает из острога и из плена, и даёт лишний бросок.</p>`,
      },
      {
        title: 'Монастырь, острог, плен',
        html: `<p>В монастыре и у помещика сидят до «Побега» или «Юрьева дня». Острог ведёт <b>по этапу</b> назад, к
          Кирилло-Белозерскому монастырю, и с этапа выпускает только «Побег». Плен у татар и ногайцев и шайка разбойников
          держат до «Побега».</p>
          <p>Смерть (заел зверь, утоп, умер от болезни) — фигурка ставится обратно в монастырь и начинает путь заново.</p>`,
      },
      {
        title: 'Дороги и развилки',
        html: `<p>От монастыря идут несколько дорог: каждый «убежавший» выбирает путь <b>по своему вкусу</b>, а у развилок
          решает сам. Побеждает тот, кто первым дойдёт до устья Дона.</p>`,
      },
    ],
  },
};
