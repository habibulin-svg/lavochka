/* Симулятор дирижёра — концерт/репетиция: сцена сверху, лента внизу, счёт и шкала зала.
 * Ввод: клавиши групп (A S D F · J K L ;), палочка — пробел (держать — фермата), динамика — ↑/↓; тач — кнопки строк,
 * тап/удержание по сцене — палочка, свайп вверх/вниз — динамика; геймпад — кнопки → группы, RT — палочка, правый стик — динамика.
 * Начало — «палочка поднята»: отсчёт такта перед первой долей. */
import { buildChart, DIFFS, type Chart, type DiffId } from './core/chart';
import type { PerfEvent } from './core/perform';
import { INSTR, type InstrId, type ScoreJson } from './core/score';
import { Orchestra } from './audio/orchestra';
import { ScorePlayer } from './audio/player';
import { KEYS, keysFor, Ribbon } from './ui/ribbon';
import { claimPad } from '../core/gamepad';
import type { Stage } from './scene/stage';

export interface ConcertSetup {
  score: ScoreJson;
  diff: DiffId;
  concert: boolean;
  speed?: number;
  /** Зал: время реверберации и название. */
  hall?: { name: string; rt60: number };
  mood?: number[];
  widen?: number[];
  from?: number;
  /** Разработка и показ: дирижирует сам (всё в точку). */
  auto?: boolean;
  /** Подсказки обучения над лентой (первые вступления, первая фермата и т. п.). */
  tutor?: boolean;
  /** Сыгранность пьесы 0..3: промах вступления стоит меньше. */
  rehearsed?: number;
  /** Репетиция: строки, которые молчат. */
  mute?: number[];
}

export interface ConcertResult {
  score: number;
  stars: number;
  acc: number;
  failed: boolean;
  bestCombo: number;
  tally: { bravo: number; good: number; off: number; miss: number };
  /** Настрой групп в конце (по строкам). */
  mood: number[];
  /** Промахи по строкам — для отзыва критика. */
  missByLane: number[];
  chart: Chart;
}

export class Concert {
  readonly el: HTMLElement;
  readonly chart: Chart;
  private player: ScorePlayer | null = null;
  private ribbon: Ribbon;
  private raf = 0;
  private last = 0;
  private paused = false;
  private disposed = false;
  private cleanup: (() => void)[] = [];
  private hud: { score: HTMLElement; combo: HTMLElement; hall: HTMLElement; hallBar: HTMLElement; title: HTMLElement; msg: HTMLElement };
  private missByLane: number[];
  private batonDown = false;
  stage: Stage | null = null;
  onEnd: (r: ConcertResult) => void = () => {};
  onPause: () => void = () => {};
  onHelp: () => void = () => {};

  constructor(
    root: HTMLElement,
    private orch: Orchestra,
    readonly setup: ConcertSetup
  ) {
    this.chart = buildChart(setup.score, DIFFS[setup.diff]);
    this.missByLane = this.chart.lanes.map(() => 0);
    this.el = document.createElement('div');
    this.el.className = 'dz-concert';
    this.el.innerHTML = `
      <div class="dz-stage"></div>
      <div class="dz-top">
        <button class="dz-ico" data-a="pause" title="Пауза (Esc)">☰</button>
        <div class="dz-title"></div>
        <div class="dz-hall" title="Зал"><span class="dz-hall-ico">👏</span><div class="dz-hall-bar"><i></i></div></div>
        <div class="dz-score">0</div>
        <div class="dz-combo"></div>
        <button class="dz-ico" data-a="help" title="Как играть">?</button>
      </div>
      <div class="dz-msg"></div>
      <div class="dz-hint"></div>`;
    root.appendChild(this.el);
    const q = (s: string) => this.el.querySelector(s) as HTMLElement;
    this.hud = { score: q('.dz-score'), combo: q('.dz-combo'), hall: q('.dz-hall'), hallBar: q('.dz-hall-bar i'), title: q('.dz-title'), msg: q('.dz-msg') };
    this.hud.title.textContent = `${setup.score.composer}. ${setup.score.title}`;
    this.hud.hall.hidden = !setup.concert;
    q('[data-a=pause]').onclick = () => this.onPause();
    q('[data-a=help]').onclick = () => this.onHelp();
    this.ribbon = new Ribbon(setup.score, this.chart, (i) => this.player?.perf.mood[i] ?? 70);
    this.ribbon.onLane = (i) => this.lane(i);
    this.el.appendChild(this.ribbon.el);
    this.bindInput();
    const ro = new ResizeObserver(() => this.layout());
    ro.observe(this.el);
    this.cleanup.push(() => ro.disconnect());
  }

  get stageEl(): HTMLElement {
    return this.el.querySelector('.dz-stage') as HTMLElement;
  }

  private layout(): void {
    const r = this.el.getBoundingClientRect();
    this.ribbon.vertical = r.height > r.width * 1.1;
    this.el.classList.toggle('portrait', this.ribbon.vertical);
    this.ribbon.resize();
    this.stage?.resize();
  }

  /** Инструменты, нужные пьесе. */
  instruments(): InstrId[] {
    return [...new Set(this.setup.score.parts.map((p) => p.instr))].filter((i) => INSTR[i]);
  }

  async start(onProgress?: (k: number) => void, waitFor?: Promise<unknown>): Promise<void> {
    if (this.setup.hall) this.orch.setHall(this.setup.hall.rt60);
    await this.orch.load(this.instruments(), onProgress);
    if (waitFor) await waitFor;
    if (this.disposed) return;
    await this.orch.ctx.resume();
    this.player = new ScorePlayer(this.orch, this.setup.score, this.chart, {
      concert: this.setup.concert,
      speed: this.setup.speed ?? 1,
      mood: this.setup.mood,
      widen: this.setup.widen,
      from: this.setup.from,
    });
    this.player.onEvent = (e) => this.event(e);
    this.player.missLevel = 0.25 + 0.12 * (this.setup.rehearsed ?? 0);
    for (const m of this.setup.mute ?? []) this.player.muted.add(m);
    this.layout();
    this.stage?.bind(this.player.perf, this.chart);
    if (this.stage?.intro) {
      if (this.setup.hall) this.say(this.setup.hall.name, 3.2);
      const skip = () => this.stage?.skip?.();
      window.addEventListener('keydown', skip, { once: true });
      this.stageEl.addEventListener('pointerdown', skip, { once: true });
      this.orch.applause(0.35, 3.5);
      await this.stage.intro();
      window.removeEventListener('keydown', skip);
    }
    this.stage?.playing?.();
    await this.countIn();
    if (this.disposed) return;
    this.player.start();
    this.last = performance.now();
    const loop = (t: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      if (this.paused || !this.player) return;
      if (this.setup.auto) this.autoplay();
      if (this.setup.tutor) this.tutor();
      this.player.update();
      this.ribbon.draw(this.player.perf, dt);
      this.stage?.update(dt, this.player.perf);
      this.drawHud();
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** «Палочка поднята»: отсчёт долей первого такта. */
  private async countIn(): Promise<void> {
    const p = this.player!;
    const spt = p.perf.secPerTick();
    const beat = 480 * spt;
    const n = 3;
    this.ribbon.draw(p.perf, 0);
    this.stage?.update(0, p.perf);
    this.stage?.raise?.(true);
    for (let k = n; k >= 1; k--) {
      if (this.disposed) return;
      this.say(String(k), Math.max(0.35, beat));
      this.click(k === n);
      await new Promise((r) => setTimeout(r, Math.max(350, beat * 1000)));
      while (this.paused && !this.disposed) await new Promise((r) => setTimeout(r, 100));
    }
    this.say('', 0);
  }

  private click(strong: boolean): void {
    const ctx = this.orch.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = strong ? 1500 : 1100;
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.07);
  }

  private sayT = 0;
  say(text: string, sec = 1.2): void {
    this.hud.msg.textContent = text;
    this.hud.msg.classList.toggle('on', !!text);
    clearTimeout(this.sayT);
    if (text && sec > 0) this.sayT = window.setTimeout(() => this.hud.msg.classList.remove('on'), sec * 1000);
  }

  private event(e: PerfEvent): void {
    if (e.kind === 'judge') {
      this.ribbon.judged(e.mark.lane, e.grade);
      if (e.grade === 'miss' && e.mark.lane >= 0) this.missByLane[e.mark.lane]++;
      this.stage?.judge(e.mark, e.grade);
    } else if (e.kind === 'fermata') {
      this.stage?.fermata(e.on);
      if (e.on) this.say('Держите!', 0.8);
    } else if (e.kind === 'fail') {
      this.say('Публика уходит…', 2);
      setTimeout(() => void this.finish(), 1800);
    } else if (e.kind === 'end') setTimeout(() => void this.finish(), 1200);
    else if (e.kind === 'dyn') this.stage?.dynamics(e.level);
  }

  private finished = false;
  private async finish(): Promise<void> {
    if (this.finished || !this.player) return;
    this.finished = true;
    const p = this.player.perf;
    const r = p.result();
    this.player.stop();
    if (!r.stars) this.orch.boo();
    else this.orch.applause(0.25 + r.stars * 0.15, 4.5);
    cancelAnimationFrame(this.raf);
    await this.stage?.outro?.();
    if (this.disposed) return;
    this.onEnd({ score: p.score, stars: r.stars, acc: r.acc, failed: p.failed, bestCombo: p.bestCombo, tally: { ...p.tally }, mood: [...p.mood], missByLane: this.missByLane, chart: this.chart });
  }

  private drawHud(): void {
    const p = this.player!.perf;
    this.hud.score.textContent = p.score.toLocaleString('ru-RU');
    const bpm = Math.round(p.tm.bpm(p.tick) * p.opts.speed * p.live);
    const tempo = Math.abs(p.live - 1) > 0.04 ? `♩ = ${bpm} ${p.live > 1 ? '▲' : '▼'}` : '';
    this.hud.combo.textContent = [tempo, p.combo >= 5 ? `серия ${p.combo} · ×${p.mult}` : ''].filter(Boolean).join(' · ');
    this.hud.hallBar.style.width = `${p.hall}%`;
    this.hud.hall.classList.toggle('low', p.hall < 25);
  }

  /** Автопилот: жмёт отметки, когда до них меньше кадра. */
  private autoplay(): void {
    const p = this.player!.perf;
    for (const m of this.chart.marks) {
      const ds = p.secTo(m.tick);
      if (ds > 0.03) break;
      if (ds < -0.05 || p.quality.has(m.id) || this.autoDone.has(m.id)) continue;
      this.autoDone.add(m.id);
      if (m.lane >= 0) this.lane(m.lane);
      else if (m.kind === 'beat') {
        this.baton(true);
        this.baton(false);
      } else if (m.kind === 'up' || m.kind === 'down') this.dyn(m.kind);
      else if (m.kind === 'hold') {
        this.baton(true);
        const sec = m.len * p.secPerTick(m.tick);
        setTimeout(() => {
          this.baton(false);
        }, sec * 1000);
      }
    }
  }
  private autoDone = new Set<number>();

  // ---- обучение: подсказка над лентой перед первыми отметками каждого вида
  private hinted = new Set<string>();
  private hintCount = 0;
  private hintT = 0;
  private tutor(): void {
    const p = this.player!.perf;
    const keys = keysFor(this.chart.lanes.length).map((k) => ['A', 'S', 'D', 'F', 'J', 'K', 'L', ';'][k]);
    const el = this.el.querySelector('.dz-hint') as HTMLElement;
    if (this.hintT && performance.now() > this.hintT) {
      el.classList.remove('on');
      this.hintT = 0;
    }
    for (const m of this.chart.marks) {
      const ds = p.secTo(m.tick);
      if (ds > 1.8) break;
      if (ds < 0.2 || p.quality.has(m.id)) continue;
      let key = '';
      let text = '';
      if (m.kind === 'cue' && this.hintCount < 5) {
        key = `cue${m.id}`;
        const l = this.chart.lanes[m.lane];
        text = `${l.name} вступают — нажмите <kbd>${keys[m.lane]}</kbd> (или кнопку «${l.short}»), когда круг дойдёт до линии`;
      } else if (m.kind === 'cut' && !this.hinted.has('cut')) {
        key = 'cut';
        text = `Квадрат — <b>снятие</b>: нажмите <kbd>${keys[m.lane]}</kbd> на последнем аккорде`;
      } else if (m.kind === 'hold' && !this.hinted.has('hold')) {
        key = 'hold';
        text = '<b>Фермата</b>: зажмите <kbd>Пробел</kbd> (или палец на сцене) и отпустите в конце полосы';
      } else if ((m.kind === 'up' || m.kind === 'down') && !this.hinted.has(m.kind)) {
        key = m.kind;
        text = m.kind === 'up' ? '<b>Громче!</b> — <kbd>↑</kbd> или проведите по сцене вверх' : '<b>Тише!</b> — <kbd>↓</kbd> или проведите по сцене вниз';
      } else if (m.kind === 'beat' && !this.hinted.has('beat')) {
        key = 'beat';
        text = '<b>Темп за вами</b>: стучите <kbd>Пробел</kbd> на каждую долю — быстрее, и оркестр ускорится';
      }
      if (!key || this.hinted.has(key)) continue;
      this.hinted.add(key);
      if (m.kind === 'cue') this.hintCount++;
      el.innerHTML = text;
      el.classList.add('on');
      this.hintT = performance.now() + 2600;
      break;
    }
  }

  lane(i: number): void {
    if (this.paused || !this.player) return;
    this.ribbon.pressed(i);
    this.player.input({ kind: 'lane', lane: i });
    this.stage?.point(i);
  }

  baton(down: boolean): void {
    if (this.paused || !this.player || down === this.batonDown) return;
    this.batonDown = down;
    this.player.input({ kind: 'baton', down });
  }

  dyn(dir: 'up' | 'down'): void {
    if (this.paused || !this.player) return;
    this.player.input({ kind: 'dyn', dir });
  }

  private bindInput(): void {
    const keyLanes = keysFor(this.chart.lanes.length);
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Escape') {
        this.onPause();
        return;
      }
      const k = KEYS.indexOf(e.code);
      const lane = keyLanes.indexOf(k);
      if (lane >= 0) {
        e.preventDefault();
        this.lane(lane);
      } else if (e.code === 'Space') {
        e.preventDefault();
        this.baton(true);
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        this.dyn('up');
      } else if (e.code === 'ArrowDown' || e.code === 'KeyX') {
        e.preventDefault();
        this.dyn('down');
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') this.baton(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    this.cleanup.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    });
    // сцена: тап/удержание — палочка, свайп — динамика
    const st = this.stageEl;
    let sy = 0;
    let sid = -1;
    let swiped = false;
    st.addEventListener('pointerdown', (e) => {
      if (sid >= 0) return;
      sid = e.pointerId;
      sy = e.clientY;
      swiped = false;
      this.baton(true);
    });
    st.addEventListener('pointermove', (e) => {
      if (e.pointerId !== sid || swiped) return;
      const dy = e.clientY - sy;
      if (Math.abs(dy) > 40) {
        swiped = true;
        this.dyn(dy < 0 ? 'up' : 'down');
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== sid) return;
      sid = -1;
      this.baton(false);
    };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', end);
    // геймпад
    const codes = keyLanes.map((k) => KEYS[k]);
    const btns = ['x', 'a', 'b', 'y', 'lb', 'rb', 'lt', 'left'] as const;
    const keys: Record<string, string> = { rt: 'Space' };
    codes.forEach((c, i) => (keys[btns[i]] = c));
    this.cleanup.push(claimPad({ map: { move: null, move2: 'arrows', keys }, hint: 'кнопки — группы · RT — палочка · правый стик ↑↓ — динамика' }));
  }

  pause(on: boolean): void {
    this.paused = on;
    this.player?.pause(on);
    if (!on) this.last = performance.now();
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.player?.stop();
    this.stage?.destroy();
    for (const c of this.cleanup) c();
    this.el.remove();
  }
}
