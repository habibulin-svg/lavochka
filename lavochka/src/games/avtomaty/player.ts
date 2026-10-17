/* Автомат «15 копеек»: эмуляция платы по образам MAME, экран — во всю область (оболочка screen.ts). Монету бросает
 * пробел (или щелчок по монетоприёмнику в углу); пока игра идёт или автомат грузится, монетоприёмник закрыт — монета
 * звякает в лоток возврата. */
import { Beeper } from '../../arcade/beeper';
import type { ArcadeMachine, MachineInput as TiaInput } from '../../arcade/machine';
import { Photon } from '../../arcade/photon';
import { Photon2 } from '../../arcade/photon2';
import { TiaMc1 } from '../../arcade/tiamc1';
import { audioOut, click, tone } from '../../core/audio';
import type { ArcadeInstance, ArcadeOpts } from '../../core/arcade';
import { esc } from '../../core/util';
import { giveBack, takeCoin } from './coins';
import type { AutoGame } from './games';
import { mountShell } from './screen';

/** Сколько держим датчик монеты (секунд эмулируемого времени). */
const COIN_HOLD_S = 0.1;

/** Время звука через d секунд (звук выключен — щелчки сами промолчат). */
const at = (d = 0) => (audioOut()?.ctx.currentTime ?? 0) + d;

const KEYS: Record<string, TiaInput> = {
  arrowleft: 'left',
  a: 'left',
  ф: 'left',
  arrowright: 'right',
  d: 'right',
  в: 'right',
  arrowup: 'up',
  w: 'up',
  ц: 'up',
  arrowdown: 'down',
  s: 'down',
  ы: 'down',
  z: 'b1',
  я: 'b1',
  control: 'b1',
  x: 'b2',
  ч: 'b2',
  shift: 'b2',
};

function makeMachine(kind: AutoGame['kind'], img: Uint8Array): ArcadeMachine {
  if (kind === 'photon') return new Photon(img);
  if (kind === 'photon2') return new Photon2(img);
  if (kind === 'morboy' || kind === 'magistral') throw new Error('«Морской бой» — не плата, у него свой вид');
  return new TiaMc1(img, kind);
}

export function mountAuto(game: AutoGame, root: HTMLElement, opts?: ArcadeOpts): ArcadeInstance {
  const buttons = [
    ...(game.b1 ? [{ id: 'b1', label: game.b1 }] : []),
    ...(game.b2 ? [{ id: 'b2', label: game.b2 }] : []),
  ];
  const sh = mountShell(root, opts, {
    cls: 'avs--crt',
    aspect: 4 / 3,
    info: `<p><b>${esc(game.title)}</b> <small>(${esc(game.board)})</small>. ${esc(game.about)}</p>
      ${game.rules ? `<details class="avt-rules"><summary>Правила с таблички</summary><ol>${game.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol></details>` : ''}
      <button class="btn small" data-a="reset" title="Выключить и включить автомат">Сброс</button>`,
    pad: game.joy === 'paddle' ? 'x' : game.kind === 'photon' ? '4' : 'xy',
    buttons,
    onCoin: () => insertCoin(),
    onInput: (k, down) => press(k as TiaInput, down),
  });
  const canvas = document.createElement('canvas');
  sh.screen.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const { say, drawPocket } = sh;

  let dead = false;
  let paused = false;
  let raf = 0;
  let machine: ArcadeMachine | null = null;
  let beeper: Beeper | null = null;
  let coinLeft = 0;
  // ---- монета
  const insertCoin = () => {
    if (!machine || paused) return;
    if (!takeCoin()) {
      say('Монеты кончились. Завтра будет ещё рубль.', 3000);
      tone(at(), { freq: 140, dur: 0.25, gain: 0.2, type: 'square' });
      drawPocket();
      return;
    }
    sh.drop();
    if (machine.coinLocked) {
      // приёмник закрыт — монета прокатилась в лоток возврата
      giveBack();
      click(at(0.35), { freq: 3800, q: 8, dur: 0.05, gain: 0.35 });
      click(at(0.44), { freq: 4200, q: 8, dur: 0.04, gain: 0.25 });
      say('Автомат монету не взял — звякнула в лоток возврата.');
    } else {
      click(at(0.3), { freq: 1600, q: 2, dur: 0.08, gain: 0.5 });
      coinLeft = machine.cpuHz * COIN_HOLD_S;
    }
    drawPocket();
  };

  // ---- ручка и кнопки: клавиши, мышь, палец
  const held = new Map<TiaInput, number>();
  // игра опрашивает кнопки раз в кадр: короткий тап держим хотя бы MIN_HOLD мс
  const MIN_HOLD = 90;
  const downAt = new Map<TiaInput, number>();
  const press = (k: TiaInput, down: boolean) => {
    const n = Math.max(0, (held.get(k) ?? 0) + (down ? 1 : -1));
    held.set(k, n);
    if (n > 0) downAt.set(k, performance.now());
    const since = performance.now() - (downAt.get(k) ?? 0);
    if (n === 0 && since < MIN_HOLD) setTimeout(() => (held.get(k) ?? 0) === 0 && machine?.set(k, false), MIN_HOLD - since);
    else machine?.set(k, n > 0);
    if (k === 'b1' || k === 'b2') sh.lit(k, n > 0);
  };
  const keysDown = new Set<string>();
  const onKey = (e: KeyboardEvent, down: boolean) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') {
      e.preventDefault();
      if (down && !e.repeat) insertCoin();
      return;
    }
    const inp = KEYS[k];
    if (!inp) return;
    e.preventDefault();
    if (down === keysDown.has(k)) return;
    if (down) keysDown.add(k);
    else keysDown.delete(k);
    press(inp, down);
  };
  const kd = (e: KeyboardEvent) => onKey(e, true);
  const ku = (e: KeyboardEvent) => onKey(e, false);
  const releaseAll = () => {
    keysDown.clear();
    for (const k of held.keys()) {
      held.set(k, 0);
      machine?.set(k, false);
    }
    sh.lit('b1', false);
    sh.lit('b2', false);
  };
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  window.addEventListener('blur', releaseAll);

  (sh.info.querySelector('[data-a=reset]') as HTMLButtonElement).onclick = () => {
    machine?.reset();
    say('Автомат перезапущен.');
  };

  void (async () => {
    const img = await fetch(`${import.meta.env.BASE_URL}avtomaty/${game.id}.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .catch((e) => {
        console.error(e);
        say('Не загрузилось — проверьте связь и откройте ещё раз.', 1e9);
        return null;
      });
    if (dead || !img) return;
    const m = makeMachine(game.kind, new Uint8Array(img));
    machine = m;
    beeper = new Beeper(m.cpuHz / m.audioDiv, 0.3);
    canvas.width = m.width;
    canvas.height = m.height;
    const image = new ImageData(new Uint8ClampedArray(m.frame.buffer as ArrayBuffer), m.width, m.height);

    let last = performance.now();
    let carry = 0;
    const frame = (t: number) => {
      if (dead || !machine) return;
      const dt = paused ? 0 : Math.min(100, t - last);
      last = t;
      // поворотная ручка «Городков»: держим стрелку — ручка крутится (96…208, у MAME наоборот)
      if (game.joy === 'paddle' && !paused) {
        const on = (k: TiaInput) => (held.get(k) ?? 0) > 0;
        const v = (on('left') ? 1 : 0) - (on('right') ? 1 : 0);
        machine.stick = Math.max(96, Math.min(208, (machine.stick ?? 152) + v * dt * 0.12));
      }
      const want = (dt * m.cpuHz) / 1000 + carry;
      if (want >= 1) {
        const n = Math.floor(want);
        if (coinLeft > 0) {
          machine.set('coin', true);
          coinLeft -= n;
        } else machine.set('coin', false);
        const buf = beeper?.live ? new Float32Array(Math.ceil(n / m.audioDiv) + 64) : null;
        const before = machine.cpu.cycles;
        const got = machine.run(n, buf);
        carry = want - (machine.cpu.cycles - before);
        if (buf) beeper!.push(buf.slice(0, got));
        ctx.putImageData(image, 0, 0);
      } else carry = want;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  })();

  return {
    pause(on) {
      paused = on;
      if (on) releaseAll();
    },
    launch() {
      insertCoin();
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      beeper?.close();
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', releaseAll);
      sh.destroy();
    },
  };
}

