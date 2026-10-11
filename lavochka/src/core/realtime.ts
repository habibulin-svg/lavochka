/* Общее для игр реального времени (настольные хоккей, баскетбол, футбол). */
import type { OptionDef, Options } from './types';

/** Скорость игры: во сколько раз медленнее жизни идёт физика (часы партии идут как обычно). Одна на всех за столом. */
export const SPEED_OPTION: OptionDef = {
  key: 'speed',
  label: 'Скорость игры',
  hint: 'физика медленнее — успеваешь разглядеть и ответить; часы идут как обычно',
  type: 'select',
  choices: [
    { value: 0.35, label: 'очень медленно' },
    { value: 0.5, label: 'медленно' },
    { value: 0.7, label: 'средне' },
    { value: 1, label: 'как в жизни' },
  ],
  default: 0.5,
};

export const gameSpeed = (opts: Options) => {
  const v = Number(opts.speed ?? SPEED_OPTION.default);
  return Number.isFinite(v) ? Math.max(0.2, Math.min(1, v)) : 0.5;
};
