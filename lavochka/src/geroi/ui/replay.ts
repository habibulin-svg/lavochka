/* Записи сетевых партий карты: сохранить файлом (сжатый JSON) и проиграть.
 * Проигрыватель притворяется клиентом сети для AdvGame в роли зрителя: шлёт ему шаги записи по одному,
 * следующий — когда AdvGame показал прошлый (`stepped`). «Быстро» — без показа ходов, «День +1» — сразу к утру. */
import type { MapClient } from '../net/mapclient';
import type { MapClock, MapServerMsg } from '../net/mapproto';
import { type MapRecord, patchJson } from '../net/record';
import type { World } from '../sim/adv/world';
import { button, h } from './common';

const EXT = '.geroi';

export async function saveRecord(rec: MapRecord): Promise<void> {
  const text = JSON.stringify(rec);
  let blob = new Blob([text], { type: 'application/json' });
  if (typeof CompressionStream !== 'undefined') blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date(rec.at);
  a.download = `geroi-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}${EXT}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Файл записи → запись; не запись — ошибка с понятным текстом. */
export async function loadRecord(file: File): Promise<MapRecord> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  const text = gz ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text() : await file.text();
  const rec = JSON.parse(text) as MapRecord;
  if (rec?.v !== 1 || !rec.world || !Array.isArray(rec.steps)) throw new Error('Это не запись партии.');
  return rec;
}

type Of<T extends MapServerMsg['t']> = Extract<MapServerMsg, { t: T }>;

/** Клиент-проигрыватель: те же обработчики, что у MapClient, которые зовёт AdvGame. */
export class ReplayClient {
  onMapStep: (m: Of<'mstep'>) => void = () => {};
  onMapNope: (why: string) => void = () => {};
  onBusy: (text: string) => void = () => {};
  onFight: (m: Of<'start'>) => void = () => {};
  onOver: (m: Of<'mover'>) => void = () => {};
  onNote: (text: string) => void = () => {};
  onPeer: (name: string, on: boolean) => void = () => {};
  /** Сколько шагов показано. */
  at = 0;
  playing = true;
  fast = false;
  private world: World;
  private waiting = false;
  readonly bar = h('div', 'g-replay');
  private label = h('span', 'dim');
  private playBtn: HTMLButtonElement;
  private fastBtn: HTMLButtonElement;
  onQuit: () => void = () => {};

  constructor(readonly rec: MapRecord) {
    this.world = structuredClone(rec.world);
    this.playBtn = button('⏸', () => this.toggle(), 'g-btn small');
    this.fastBtn = button('Быстро', () => {
      this.fast = !this.fast;
      this.fastBtn.classList.toggle('on', this.fast);
    }, 'g-btn small');
    this.bar.append(this.playBtn, this.fastBtn, button('День +1', () => this.nextDay(), 'g-btn small'), this.label, button('Выйти', () => this.onQuit(), 'g-btn small'));
    this.show();
  }

  /** Мир на старте и часы для AdvGame. */
  get start(): { world: World; clock: MapClock } {
    const n = this.rec.seats.length;
    return { world: structuredClone(this.rec.world), clock: { bank: Array(n).fill(0), running: [], free: false, done: Array(n).fill(false) } };
  }

  /** Как MapClient для AdvGame: ходить зрителю нельзя. */
  get asClient(): MapClient {
    return this as unknown as MapClient;
  }
  adv(): void {}
  surrender(): void {}
  close(): void {
    this.playing = false;
  }

  /** AdvGame показал шаг: можно следующий. */
  stepped(): void {
    this.waiting = false;
    this.show();
    if (this.playing) setTimeout(() => this.next(), this.fast ? 30 : 250);
  }

  begin(): void {
    this.next();
  }

  private toggle(): void {
    this.playing = !this.playing;
    this.playBtn.textContent = this.playing ? '⏸' : '▶';
    if (this.playing) this.next();
  }

  private next(): void {
    if (this.waiting || !this.playing) return;
    const st = this.rec.steps[this.at];
    if (!st) return this.end();
    this.at++;
    this.world = patchJson(this.world, st.d);
    this.send(this.fast ? st.ev.filter((e) => e.e === 'over' || e.e === 'lost') : st.ev, st.actor);
  }

  /** Все шаги до следующего дня — без показа, одним махом. */
  private nextDay(): void {
    if (this.waiting) return;
    const day = this.world.day;
    while (this.at < this.rec.steps.length && this.world.day === day) this.world = patchJson(this.world, this.rec.steps[this.at++].d);
    this.send([], -1);
  }

  private send(events: Of<'mstep'>['events'], actor: number): void {
    this.waiting = true;
    const n = this.rec.seats.length;
    this.onMapStep({ t: 'mstep', events, world: structuredClone(this.world), clock: { bank: Array(n).fill(0), running: [], free: false, done: Array(n).fill(false) }, seats: this.rec.seats, actor });
    if (this.at >= this.rec.steps.length) this.end();
  }

  private end(): void {
    this.playing = false;
    this.playBtn.textContent = '▶';
    this.show();
    if (this.world.over) this.onOver({ t: 'mover', winner: this.world.winner, why: 'map' });
  }

  private show(): void {
    this.label.textContent = `День ${this.world.day + 1} · шаг ${this.at} из ${this.rec.steps.length}`;
  }
}
