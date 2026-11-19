/* Симулятор дирижёра — исполнение: часы дирижёра (тик по времени с живым темпом), судейство отметок,
 * шкала зала, настрой групп, серия и очки. Без DOM и звука: звук и картинка подписываются на события.
 *
 * Часы: тик растёт со скоростью темпа партитуры × множитель (репетиция медленнее) × живой множитель (палочка в «ускоряй»).
 * Фермата: часы стоят, пока держите палочку (или пока не выйдет время по партитуре, если не держали). */
import type { Chart, Mark } from './chart';
import { PPQ, TempoMap, type ScoreJson } from './score';

export type Grade = 'bravo' | 'good' | 'early' | 'late' | 'miss';

/** Окна попадания, секунды (по модулю). */
export const WINDOW = { bravo: 0.07, good: 0.13, ok: 0.21 };

export type Input =
  | { kind: 'lane'; lane: number }
  | { kind: 'baton'; down: boolean }
  | { kind: 'dyn'; dir: 'up' | 'down' };

export type PerfEvent =
  | { kind: 'judge'; mark: Mark; grade: Grade; err: number }
  /** Нажали, а отметки рядом нет. */
  | { kind: 'stray'; lane: number }
  | { kind: 'fermata'; on: boolean }
  | { kind: 'dyn'; level: number }
  | { kind: 'fail' }
  | { kind: 'end' };

export interface PerfOpts {
  /** Концерт: промахи штрафуются, пустая шкала — провал. Репетиция — без провала. */
  concert: boolean;
  /** Множитель темпа (репетиция 0.6–1). */
  speed: number;
  /** Настрой групп на старте, 0..100 (по строкам). */
  mood?: number[];
  /** Окно попадания шире (улучшения оркестра), по строкам: 1 — как есть, 1.3 — на 30 % шире. */
  widen?: number[];
  /** Начать с тика (репетиция с буквы). */
  from?: number;
}

export interface Tally {
  bravo: number;
  good: number;
  off: number;
  miss: number;
}

export class Performance {
  readonly tm: TempoMap;
  tick: number;
  /** Живой множитель темпа (палочка). */
  live = 1;
  hall = 60;
  combo = 0;
  bestCombo = 0;
  score = 0;
  mood: number[];
  tally: Tally = { bravo: 0, good: 0, off: 0, miss: 0 };
  /** Как сыграна фраза каждого вступления: id отметки → качество 0..1 (1 — уверенно). */
  readonly quality = new Map<number, number>();
  /** Громкость оркестра, 0.5..1.4 (динамика палочкой). */
  dyn = 1;
  failed = false;
  ended = false;
  private next = 0;
  private judged = new Set<number>();
  private hold: { mark: Mark; since: number; held: boolean } | null = null;
  private batonDown = false;
  private beatTaps: number[] = [];
  private dynTarget = 1;
  /** Секунды с начала (для тапов палочки). */
  private clockSec = 0;

  constructor(
    readonly score_: ScoreJson,
    readonly chart: Chart,
    readonly opts: PerfOpts
  ) {
    this.tm = new TempoMap(score_.tempo);
    this.tick = opts.from ?? 0;
    this.mood = chart.lanes.map((_, i) => opts.mood?.[i] ?? 70);
    while (this.next < chart.marks.length && chart.marks[this.next].tick < this.tick) this.judged.add(this.chart.marks[this.next++].id);
  }

  /** Секунд на тик сейчас. */
  secPerTick(at = this.tick): number {
    return 60 / (this.tm.bpm(at) * PPQ) / (this.opts.speed * this.live);
  }

  /** Сколько секунд до тика (по текущему темпу — для ленты и судейства). */
  secTo(tick: number): number {
    return (tick - this.tick) * this.secPerTick();
  }

  get frozen(): boolean {
    return !!this.hold && this.tick >= this.hold.mark.tick;
  }

  /** Шаг часов. Возвращает события (промахи по прошедшим отметкам, конец). */
  step(dt: number): PerfEvent[] {
    const ev: PerfEvent[] = [];
    if (this.ended || this.failed) return ev;
    this.clockSec += dt;
    // фермата: часы стоят на её тике
    const h = this.hold;
    if (h && this.tick >= h.mark.tick) {
      this.tick = h.mark.tick;
      const nominal = h.mark.len * (60 / (this.tm.bpm(h.mark.tick) * PPQ)) / this.opts.speed;
      // держат — ждём отпускания (не дольше тройной); не держат — стоим по партитуре и идём дальше
      if ((h.held && this.clockSec - h.since > nominal * 3) || (!h.held && this.clockSec - h.since > nominal)) {
        this.endHold(ev, h.held ? 'late' : 'miss');
      }
    } else {
      let left = dt;
      // не перескочить фермату за один шаг
      while (left > 0) {
        const sp = this.secPerTick();
        let dTick = left / sp;
        const nh = this.hold?.mark ?? this.upcomingHold();
        if (nh && this.tick < nh.tick && this.tick + dTick >= nh.tick) {
          dTick = nh.tick - this.tick;
          this.tick = nh.tick;
          left -= dTick * sp;
          if (this.hold) this.hold.since = this.clockSec - left;
          else {
            this.hold = { mark: nh, since: this.clockSec - left, held: this.batonDown };
            if (this.batonDown) this.judgeMark(nh, 0, ev);
          }
          ev.push({ kind: 'fermata', on: true });
          break;
        }
        this.tick += dTick;
        left = 0;
      }
    }
    // живой темп возвращается к партитуре, если палочку не трогают
    const inZone = this.beatZone();
    if (!inZone) this.live += (1 - this.live) * Math.min(1, dt * 1.5);
    // динамика плавно
    this.dynTarget += (1 - this.dynTarget) * Math.min(1, dt * 0.08);
    this.dyn += (this.dynTarget - this.dyn) * Math.min(1, dt * 3);
    // прошедшие без нажатия — промах
    const marks = this.chart.marks;
    while (this.next < marks.length) {
      const m = marks[this.next];
      if (this.judged.has(m.id)) {
        this.next++;
        continue;
      }
      if (m.kind === 'hold') {
        if (this.tick < m.tick) break;
        this.next++;
        continue; // фермату судит отпускание
      }
      const late = -this.secTo(m.tick);
      if (late <= WINDOW.ok * this.widen(m.lane)) break;
      this.next++;
      this.judgeMark(m, null, ev);
    }
    if (this.tick >= this.score_.end && !this.hold && this.next >= marks.length) {
      this.ended = true;
      ev.push({ kind: 'end' });
    }
    return ev;
  }

  private widen(lane: number): number {
    return lane >= 0 ? this.opts.widen?.[lane] ?? 1 : 1;
  }

  private upcomingHold(): Mark | null {
    for (let i = this.next; i < this.chart.marks.length; i++) {
      const m = this.chart.marks[i];
      if (m.tick > this.tick + PPQ * 8) return null;
      if (m.kind === 'hold' && !this.judged.has(m.id) && m.tick >= this.tick) return m;
    }
    return null;
  }

  private beatZone(): boolean {
    for (let i = Math.max(0, this.next - 1); i < this.chart.marks.length; i++) {
      const m = this.chart.marks[i];
      if (m.tick > this.tick + PPQ * 2) break;
      if (m.kind === 'beat' && Math.abs(m.tick - this.tick) < PPQ * 2) return true;
    }
    return false;
  }

  /** Ближайшая неосуждённая отметка, подходящая под ввод, в окне. */
  private findMark(match: (m: Mark) => boolean, lane: number): { m: Mark; err: number } | null {
    let best: { m: Mark; err: number } | null = null;
    const w = WINDOW.ok * this.widen(lane) * 1.6;
    for (let i = Math.max(0, this.next - 8); i < this.chart.marks.length; i++) {
      const m = this.chart.marks[i];
      const err = -this.secTo(m.tick); // >0 — нажали позже
      if (err < -w) break;
      if (this.judged.has(m.id) || !match(m) || err > w) continue;
      if (!best || Math.abs(err) < Math.abs(best.err)) best = { m, err };
    }
    return best;
  }

  input(i: Input): PerfEvent[] {
    const ev: PerfEvent[] = [];
    if (this.ended || this.failed) return ev;
    if (i.kind === 'lane') {
      const f = this.findMark((m) => m.lane === i.lane && (m.kind === 'cue' || m.kind === 'cut' || m.kind === 'solo'), i.lane);
      if (f) this.judgeMark(f.m, f.err, ev);
      else ev.push({ kind: 'stray', lane: i.lane });
    } else if (i.kind === 'baton') {
      this.batonDown = i.down;
      if (i.down) {
        // тап палочки в «ускоряй»: темп за тапами
        this.beatTaps.push(this.clockSec);
        if (this.beatTaps.length > 4) this.beatTaps.shift();
        const f = this.findMark((m) => m.kind === 'beat', -1);
        if (f) {
          this.judgeMark(f.m, f.err, ev);
          this.followTaps(f.m);
        }
        // фермата впереди — нажали заранее: держим
        const nh = this.upcomingHold();
        if (nh && this.secTo(nh.tick) < WINDOW.ok * 1.6) {
          this.hold = { mark: nh, since: this.clockSec, held: true };
          this.judgeMark(nh, -this.secTo(nh.tick), ev);
        } else if (this.hold && !this.hold.held) {
          this.hold.held = true;
          this.judgeMark(this.hold.mark, this.clockSec - this.hold.since, ev);
        }
      } else if (this.hold && this.hold.held && this.tick >= this.hold.mark.tick) {
        // отпустили фермату: хорошо — около её длины по партитуре (±40 %)
        const nominal = this.hold.mark.len * (60 / (this.tm.bpm(this.hold.mark.tick) * PPQ)) / this.opts.speed;
        const r = (this.clockSec - this.hold.since) / Math.max(0.2, nominal);
        this.endHold(ev, r >= 0.6 && r <= 1.6 ? 'bravo' : r >= 0.35 ? 'good' : 'early');
      }
    } else if (i.kind === 'dyn') {
      const f = this.findMark((m) => m.kind === i.dir, -1);
      if (f) {
        this.judgeMark(f.m, f.err, ev);
        if (this.lastGrade !== 'miss') this.dynTarget = i.dir === 'up' ? 1.35 : 0.55;
        ev.push({ kind: 'dyn', level: this.dynTarget });
      } else ev.push({ kind: 'stray', lane: -1 });
    }
    return ev;
  }

  private endHold(ev: PerfEvent[], grade: Grade): void {
    const h = this.hold!;
    this.hold = null;
    ev.push({ kind: 'fermata', on: false });
    // фермата судится один раз: при нажатии (если не нажали — промах) и бонус за отпускание вовремя
    if (grade === 'bravo') this.addScore(60);
    if (!this.judged.has(h.mark.id)) this.judgeMark(h.mark, null, ev);
  }

  private followTaps(m: Mark): void {
    if (this.beatTaps.length < 2) return;
    const n = this.beatTaps.length;
    const iv = (this.beatTaps[n - 1] - this.beatTaps[0]) / (n - 1);
    const beatSec = (this.chart.marks.find((x) => x.kind === 'beat' && x.tick > m.tick)?.tick ?? m.tick + PPQ) - m.tick;
    const nominal = (beatSec * 60) / (this.tm.bpm(m.tick) * PPQ * this.opts.speed);
    if (iv <= 0.05 || iv > 3) return;
    const want = Math.max(0.6, Math.min(1.6, nominal / iv));
    this.live += (want - this.live) * 0.5;
  }

  private lastGrade: Grade = 'miss';

  private judgeMark(m: Mark, err: number | null, ev: PerfEvent[]): void {
    if (this.judged.has(m.id)) return;
    this.judged.add(m.id);
    const w = this.widen(m.lane);
    let grade: Grade;
    if (err === null) grade = 'miss';
    else {
      const a = Math.abs(err);
      grade = a <= WINDOW.bravo * w ? 'bravo' : a <= WINDOW.good * w ? 'good' : a <= WINDOW.ok * w * 1.6 ? (err < 0 ? 'early' : 'late') : 'miss';
    }
    this.lastGrade = grade;
    const q = grade === 'bravo' ? 1 : grade === 'good' ? 0.85 : grade === 'miss' ? 0 : 0.55;
    if (m.kind === 'cue' || m.kind === 'solo') this.quality.set(m.id, q);
    if (grade === 'miss') {
      this.combo = 0;
      this.tally.miss++;
      if (this.opts.concert) this.hall = Math.max(0, this.hall - 7);
      if (m.lane >= 0) this.mood[m.lane] = Math.max(0, this.mood[m.lane] - 6);
    } else {
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      if (grade === 'bravo') this.tally.bravo++;
      else if (grade === 'good') this.tally.good++;
      else this.tally.off++;
      this.hall = Math.min(100, this.hall + (grade === 'bravo' ? 3 : grade === 'good' ? 2 : 1));
      if (m.lane >= 0) this.mood[m.lane] = Math.min(100, this.mood[m.lane] + (grade === 'bravo' ? 3 : 1.5));
      this.addScore(grade === 'bravo' ? 100 : grade === 'good' ? 70 : 35);
    }
    ev.push({ kind: 'judge', mark: m, grade, err: err ?? 0 });
    if (this.opts.concert && this.hall <= 0 && !this.failed) {
      this.failed = true;
      ev.push({ kind: 'fail' });
    }
  }

  get mult(): number {
    return Math.min(4, 1 + Math.floor(this.combo / 10));
  }

  private addScore(base: number): void {
    this.score += base * this.mult;
  }

  /** Качество, с которым звучит нота строки на тике: уверенность фразы × настрой. 0..1. */
  noteQuality(cueId: number, lane: number): number {
    const q = cueId < 0 ? 1 : this.quality.get(cueId) ?? 1; // ещё не судили — играет (прогноз)
    const moodK = 0.75 + 0.25 * (this.mood[lane] / 100);
    return q * moodK;
  }

  /** Итог: доля попаданий, звёзды 0..5. */
  result(): { acc: number; stars: number } {
    const t = this.tally;
    const n = t.bravo + t.good + t.off + t.miss;
    const acc = n ? (t.bravo + t.good * 0.8 + t.off * 0.45) / n : 1;
    const stars = this.failed ? 0 : acc >= 0.95 ? 5 : acc >= 0.85 ? 4 : acc >= 0.7 ? 3 : acc >= 0.5 ? 2 : 1;
    return { acc, stars };
  }
}
