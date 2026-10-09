import type { Rng } from './types';

/** mulberry32: быстрый, с 32-битным состоянием, которое легко сохранить. */
export class SeededRng implements Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed | 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  getState(): number {
    return this.s;
  }
}

/** Для показа правил: int() сначала отдаёт заранее заданные значения, потом — обычный случай. */
export class RiggedRng implements Rng {
  private queue: number[] = [];
  constructor(private base: Rng) {}
  rig(values: number[] | undefined) {
    this.queue = values ? values.slice() : [];
  }
  next(): number {
    return this.base.next();
  }
  int(n: number): number {
    if (this.queue.length) return Math.min(n - 1, Math.max(0, this.queue.shift()!));
    return this.base.int(n);
  }
  getState(): number {
    return this.base.getState();
  }
}

export function randomSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
