// Рандомизированный генератор — mulberry32 (совпадает с studio/post/terrain.py)
export function fnv1a(s: string): number {
  const bytes = new TextEncoder().encode(s);
  let h = 0x811C9DC5;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  u32(): number {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  f(): number {
    return this.u32() / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.f();
  }

  int(a: number, b: number): number {
    return a + Math.trunc(this.f() * (b - a + 1));
  }

  below(n: number): number {
    return Math.trunc(this.f() * n);
  }
}
