/* Правила игры с наглядным показом: каждый раздел может проигрывать сценарий на настоящем поле игры. */
import { RiggedRng, SeededRng } from './rng';
import type { DemoScript, GameDef } from './types';
import { modal } from './ui';
import { esc, h, sleep } from './util';
import type { GameModule, GameView, ViewCtx } from './view';
import { settings } from './settings';

class DemoPlayer {
  private view: GameView;
  private def: GameDef;
  private state: any;
  private rng!: RiggedRng;
  private i = 0;
  private token = 0;
  private busy = false;
  private caption: HTMLElement;
  private playBtn: HTMLButtonElement;
  private stepBtn: HTMLButtonElement;
  el: HTMLElement;

  constructor(
    mod: GameModule,
    private script: DemoScript<any, any>
  ) {
    this.def = mod.def;
    this.el = h(`<div class="demo">
        <div class="demo-head">
          <div class="demo-caption"></div>
          <div class="demo-buttons">
            <button class="btn small" data-a="reset" title="Сначала">⟲</button>
            <button class="btn small" data-a="step" title="Следующий ход">Шаг ⏭</button>
            <button class="btn small primary" data-a="play">▶ Показать</button>
          </div>
        </div>
        <div class="demo-stage"><div class="demo-board"></div><div class="demo-controls"></div></div>
      </div>`);
    this.caption = this.el.querySelector('.demo-caption') as HTMLElement;
    this.playBtn = this.el.querySelector('[data-a=play]') as HTMLButtonElement;
    this.stepBtn = this.el.querySelector('[data-a=step]') as HTMLButtonElement;
    (this.el.querySelector('[data-a=reset]') as HTMLButtonElement).onclick = () => this.reset();
    this.stepBtn.onclick = () => void this.step();
    this.playBtn.onclick = () => void this.play();

    const names = new Map(script.seats.map((s) => [s.seat, s.name]));
    const ctx: ViewCtx = {
      act: () => {},
      mySeats: [],
      demo: true,
      controls: this.el.querySelector('.demo-controls') as HTMLElement,
      name: (seat) => `<span class="nm" style="--c:${this.def.seats[seat]?.ink ?? this.def.seats[seat]?.color}">${esc(names.get(seat) ?? this.def.seats[seat]?.name)}</span>`,
      speed: () => settings.speed,
      autoSingle: () => false,
    };
    this.view = mod.createView();
    this.view.mount(this.el.querySelector('.demo-board') as HTMLElement, ctx);
    this.reset();
  }

  reset() {
    this.token++;
    this.busy = false;
    this.rng = new RiggedRng(new SeededRng(20240607));
    const opts = Object.assign({}, defaultOptions(this.def), this.script.options || {});
    this.state = this.script.setup ? this.script.setup(this.def, this.rng) : this.def.setup(this.script.seats, opts, this.rng);
    this.i = 0;
    this.view.setView(this.def.view(this.state, 'all'));
    this.view.setTurn([], []);
    this.caption.innerHTML = this.script.intro ? esc(this.script.intro) : 'Нажмите «Показать».';
    this.updateButtons();
  }

  private updateButtons() {
    const done = this.i >= this.script.steps.length;
    this.stepBtn.disabled = this.busy || done;
    this.playBtn.disabled = this.busy;
    this.playBtn.textContent = done ? '▶ Ещё раз' : '▶ Показать';
  }

  private async step(): Promise<boolean> {
    if (this.busy || this.i >= this.script.steps.length) return false;
    const token = this.token;
    const st = this.script.steps[this.i];
    this.rng.rig(st.rig);
    const res = this.def.apply(this.state, st.seat, st.action, this.rng);
    if (!res) {
      this.caption.textContent = '⚠ Ход из показа не подошёл к позиции.';
      console.warn('demo step rejected', this.def.id, this.i, st);
      return false;
    }
    this.busy = true;
    this.updateButtons();
    this.state = res.state;
    if (st.caption) this.caption.textContent = st.caption;
    await this.view.play(res.events, this.def.view(this.state, 'all'));
    if (token !== this.token) return false;
    this.i++;
    this.busy = false;
    this.updateButtons();
    return true;
  }

  private async play() {
    if (this.busy) return;
    if (this.i >= this.script.steps.length) this.reset();
    const token = this.token;
    while (this.i < this.script.steps.length && token === this.token) {
      const ok = await this.step();
      if (!ok || token !== this.token) return;
      if (this.i < this.script.steps.length) await sleep(1300 / settings.speed);
    }
  }

  destroy() {
    this.token++;
    this.view.destroy?.();
    this.el.remove();
  }
}

export function defaultOptions(def: GameDef): Record<string, any> {
  const o: Record<string, any> = {};
  for (const opt of def.options || []) o[opt.key] = opt.default;
  return o;
}

/** Открыть правила игры. */
export function openRules(mod: GameModule) {
  const def = mod.def;
  const root = h(`<div class="rules">
      <h2>${esc(def.title)}: правила</h2>
      <p class="rules-goal"><b>Цель.</b> ${def.rules.goal}</p>
      <div class="rules-layout">
        <nav class="rules-nav"></nav>
        <div class="rules-body"><div class="rules-text"></div><div class="rules-demo"></div></div>
      </div>
    </div>`);
  const nav = root.querySelector('.rules-nav') as HTMLElement;
  const text = root.querySelector('.rules-text') as HTMLElement;
  const demoBox = root.querySelector('.rules-demo') as HTMLElement;
  let player: DemoPlayer | null = null;

  const open = (i: number) => {
    const sec = def.rules.sections[i];
    nav.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', i === j));
    text.innerHTML = `<h3>${esc(sec.title)}</h3>${sec.html}`;
    player?.destroy();
    player = null;
    demoBox.hidden = !sec.demo;
    if (sec.demo) {
      player = new DemoPlayer(mod, sec.demo);
      demoBox.appendChild(player.el);
    }
  };
  def.rules.sections.forEach((s, i) => {
    const b = document.createElement('button');
    b.innerHTML = `${esc(s.title)}${s.demo ? ' <span class="has-demo" title="Есть показ">▶</span>' : ''}`;
    b.onclick = () => open(i);
    nav.appendChild(b);
  });
  const m = modal(root, [{ text: 'Понятно', primary: true }], { wide: true, cls: 'rules-modal' });
  const close = m.close;
  m.close = () => {
    player?.destroy();
    close();
  };
  // закрытие кликом мимо окна или Esc тоже должно остановить показ
  new MutationObserver((_r, obs) => {
    if (!m.el.isConnected) {
      player?.destroy();
      obs.disconnect();
    }
  }).observe(document.body, { childList: true });
  open(0);
  return m;
}
