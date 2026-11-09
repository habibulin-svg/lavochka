/* Дворовый спорт — пошаговый показ правил для игр реального времени (лапта, пекарь, чиж). Общий показ правил
 * (core/rules.ts) и его тест ходят через def.apply(state, seat, action, rng) → view.play(events, view): здесь «ход» показа —
 * это кусок партии: N шагов движка с заданным вводом сторон (свой пацан бежит, бьёт, ловит; остальных ведёт ИИ).
 * Результат — одно событие { k: 'frames' } со снимками через шаг: экран проигрывает их своим realtime(), как живую партию.
 * Детерминированно: тот же движок и тот же rng (показ правил и его тест начинают с одного зерна), rig подкручивает rng.int.
 *
 * Подключение в игре:
 *   def.apply = (s, seat, a, rng) => demoApply(s, a, rng, { step, view: snapshot }),
 *   демо-позиция — со флагом s.demo = true (иначе apply отказывает: настоящая комната так «перемотать» партию не даст),
 *   шаг показа — { seat, action: rtStep({ ticks, inputs: { [место]: ввод }, until: 'salit' }), caption },
 *   view.play(events, v): for (const e of events) if (isFrames(e)) await playFrames(e, (f, evs) => this.realtime(f, evs), мс_на_кадр).
 * Без DOM (кроме playFrames — она только ждёт таймером). */

/** Действие показа: крутить движок. */
export interface RtStep<I = unknown> {
  type: 'rt';
  /** Сколько шагов движка (не больше). */
  ticks: number;
  /** Ввод по местам (держится все шаги; места без ввода — ИИ движка / ввод простоя). */
  inputs: Record<number, I>;
  /** Остановиться после события этого вида (и ещё tail шагов — чтобы досмотреть). */
  until?: string;
  tail?: number;
  /** Снимок каждые every шагов (по умолчанию 2). */
  every?: number;
}

export interface FramesEvent<V = unknown, E = unknown> {
  k: 'frames';
  frames: V[];
  /** События движка, случившиеся к каждому снимку. */
  evs: E[][];
  /** Сколько шагов движка между снимками. */
  every: number;
}

export const rtStep = <I>(o: Omit<RtStep<I>, 'type'>): RtStep<I> => ({ type: 'rt', ...o });

export const isFrames = (e: unknown): e is FramesEvent => !!e && typeof e === 'object' && (e as { k?: string }).k === 'frames';

interface Engine<S, I, E, V> {
  step(s: S, inputs: (I | null | undefined)[], rng: { next(): number; int(n: number): number; getState(): number }): E[];
  view(s: S): V;
}

/** «Ход» показа: прогнать движок на копии позиции. null — не показ (настоящая партия) или не то действие. */
export function demoApply<S extends { demo?: boolean; over?: boolean }, I, E extends { k: string }, V>(
  s0: S,
  a: unknown,
  rng: { next(): number; int(n: number): number; getState(): number },
  eng: Engine<S, I, E, V>,
): { state: S; events: FramesEvent<V, E>[] } | null {
  const st = a as RtStep<I>;
  if (!s0.demo || !st || st.type !== 'rt' || !Number.isFinite(st.ticks) || st.ticks <= 0) return null;
  const s = JSON.parse(JSON.stringify(s0)) as S;
  const every = Math.max(1, Math.round(st.every ?? 2));
  const top = Math.max(1, ...Object.keys(st.inputs ?? {}).map(Number)) + 1;
  const inputs: (I | null)[] = Array.from({ length: Math.max(top, 2) }, (_, i) => (st.inputs?.[i] ?? null) as I | null);
  const frames: V[] = [eng.view(s)];
  const evs: E[][] = [[]];
  let pend: E[] = [];
  let stopAt = -1;
  const max = Math.min(st.ticks, 60 * 60);
  for (let i = 0; i < max; i++) {
    const ev = eng.step(s, inputs, rng);
    pend.push(...ev);
    if (stopAt < 0 && st.until && ev.some((e) => e.k === st.until)) stopAt = i + (st.tail ?? 45);
    if ((i + 1) % every === 0 || ev.length) {
      frames.push(eng.view(s));
      evs.push(pend);
      pend = [];
    }
    if (s.over || (stopAt >= 0 && i >= stopAt)) break;
  }
  if (pend.length) {
    frames.push(eng.view(s));
    evs.push(pend);
  }
  return { state: s, events: [{ k: 'frames', frames, evs, every }] };
}

/** Проиграть снимки показа: show(снимок, события) с шагом ms (скорость показа — у вызывающего). */
export async function playFrames<V, E>(e: FramesEvent<V, E>, show: (v: V, evs: E[]) => void, ms: () => number): Promise<void> {
  for (let i = 0; i < e.frames.length; i++) {
    show(e.frames[i], e.evs[i] ?? []);
    await new Promise((r) => setTimeout(r, ms()));
  }
}
