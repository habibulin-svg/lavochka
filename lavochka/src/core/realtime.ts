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

/** Скорость, присланная игроком за столом (поле sp ввода), или undefined. */
export function cleanSpeed(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0.2, Math.min(1, v)) : undefined;
}

/** Применить смену скорости из ввода места: каждое новое значение места — один раз (ввод повторяется, пока шлётся). */
export function applySpeed(st: { speed: number; spSeen?: number[] }, seat: number, sp: number | undefined) {
  if (sp == null) return;
  st.spSeen ??= [];
  if (st.spSeen[seat] === sp) return;
  st.spSeen[seat] = sp;
  st.speed = sp;
}
