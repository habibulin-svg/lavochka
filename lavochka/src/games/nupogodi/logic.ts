/* «Ну, погоди!» (ИМ-02) — логика без DOM.
 * Четыре жёлоба (левый верхний, левый нижний, правый верхний, правый нижний), по каждому яйцо скатывается за пять шагов.
 * Волк с корзиной встаёт к одному из жёлобов (четыре кнопки). Поймал — очко. Упало — разбилось, цыплёнок убегает: штраф.
 * Пока в окошке заяц — штраф половинный. Три полных штрафа — конец игры. На 200 и 500 очках штрафы прощаются.
 * Игра Б быстрее и с большим числом яиц сразу. Яйца двигаются все разом на каждом тике; новое — не чаще одного за тик,
 * поэтому до корзины они доходят по одному. */
import { lcdRng, type LcdBeep, type LcdLogic } from '../../arcade/lcd-core';

export const RAMPS = ['lu', 'ld', 'ru', 'rd'] as const;
export type Ramp = (typeof RAMPS)[number];
export const STEPS = 5;

export class NuPogodi implements LcdLogic {
  pos: Ramp = 'lu';
  eggs: { ramp: number; step: number }[] = [];
  score = 0;
  /** Штрафы в половинках: 2 — полный, 1 — половинный. */
  misses = 0;
  over = false;
  /** Цыплёнок бежит после промаха (номер кадра) и с какой стороны. */
  anim: { side: 'l' | 'r'; t: number } | null = null;
  hare = 0;
  private hareWait = 60;
  private cool = 3;
  private ticks = 0;
  private rnd: () => number;

  constructor(readonly mode: 'A' | 'B', seed: number) {
    this.rnd = lcdRng(seed);
  }

  press(btn: string) {
    if ((RAMPS as readonly string[]).includes(btn)) this.pos = btn as Ramp;
  }

  private maxEggs() {
    const base = this.mode === 'A' ? 1 : 2;
    return Math.min(this.mode === 'A' ? 4 : 5, base + Math.floor(this.score / 30));
  }

  interval() {
    const base = this.mode === 'A' ? 520 : 420;
    // темп растёт с очками, после каждой сотни чуть отпускает
    return Math.max(170, base - (this.score % 100) * 1.6 - Math.floor(this.score / 100) * 30);
  }

  tick(): LcdBeep[] {
    if (this.over) return [];
    this.ticks++;
    // заяц в окошке
    if (this.hare > 0) this.hare--;
    else if (--this.hareWait <= 0) {
      this.hare = 25 + Math.floor(this.rnd() * 20);
      this.hareWait = 70 + Math.floor(this.rnd() * 60);
    }
    // цыплёнок убегает — игра стоит
    if (this.anim) {
      this.anim.t++;
      if (this.anim.t >= 4) this.anim = null;
      return [this.anim ? 660 : 330];
    }
    const beeps: LcdBeep[] = [];
    const kept: { ramp: number; step: number }[] = [];
    for (const e of this.eggs) {
      e.step++;
      if (e.step < STEPS) {
        kept.push(e);
        continue;
      }
      if (RAMPS[e.ramp] === this.pos) {
        this.score = (this.score + 1) % 1000;
        beeps.push(1800);
        if (this.score === 200 || this.score === 500) this.misses = 0;
      } else {
        this.misses += this.hare > 0 ? 1 : 2;
        this.anim = { side: e.ramp < 2 ? 'l' : 'r', t: 0 };
        beeps.push(300);
        if (this.misses >= 6) this.over = true;
        // после промаха жёлоба пустеют — как будто куры испугались
        this.eggs = [];
        return beeps;
      }
    }
    this.eggs = kept;
    if (--this.cool <= 0 && this.eggs.length < this.maxEggs()) {
      // жёлоб, где яйцо сейчас наверху, не повторяем — иначе два яйца слипнутся
      const free = [0, 1, 2, 3].filter((r) => !this.eggs.some((e) => e.ramp === r && e.step === 0));
      const ramp = free[Math.floor(this.rnd() * free.length)];
      this.eggs.push({ ramp, step: 0 });
      this.cool = 1 + Math.floor(this.rnd() * (this.mode === 'A' ? 3 : 2));
    }
    if (!beeps.length && this.eggs.length) beeps.push([880, 990, 1175, 1320][this.eggs[0].ramp]);
    return beeps;
  }

  lit(out: Set<string>) {
    const left = this.pos[0] === 'l';
    out.add(left ? 'wolf_l' : 'wolf_r');
    out.add(`arm_${this.pos}`);
    for (const e of this.eggs) out.add(`egg_${RAMPS[e.ramp]}_${e.step}`);
    if (this.anim) {
      out.add(`broke_${this.anim.side}`);
      out.add(`chick_${this.anim.side}${Math.min(3, this.anim.t)}`);
    }
    if (this.hare > 0) out.add('hare');
    const full = Math.floor(this.misses / 2);
    for (let i = 0; i < full; i++) out.add(`miss${i}`);
    // половинный штраф мигает
    if (this.misses % 2 && this.ticks % 2) out.add(`miss${full}`);
  }
}
