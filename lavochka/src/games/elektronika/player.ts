/* Корпус «Электроники» на экране: фон-плёнка, ЖК из SVG MAME (multiply по фону, как стекло), корпус поверх,
 * кнопки — щелчок/палец/клавиши. Эмулятор крутится по часам страницы; состояние сохраняется — часы и рекорд
 * на приборе живут, пока «батарейки» (localStorage) не вынули. */
import { Beeper } from '../../arcade/beeper';
import { CLOCK_HZ, GwMachine, segIndex, type GwSave } from '../../arcade/gw';
import type { ArcadeInstance } from '../../core/arcade';
import { store } from '../../core/settings';
import { esc } from '../../core/util';
import type { GwButton, GwGame } from './games';
import './elektronika.css';

interface Layout {
  w: number;
  h: number;
  screen: [number, number, number, number];
  shadow: { b: [number, number, number, number]; alpha: number } | null;
  under: [number, number, number, number];
  buttons: { port: string; mask: number; b: [number, number, number, number]; img: string }[];
}

const base = (id: string) => `${import.meta.env.BASE_URL}elektronika/${id}/`;
const saveKey = (id: string) => `elektronika.${id}`;

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
const keyOf = (e: KeyboardEvent) => (e.code.startsWith('Numpad') && e.code.length > 6 && /\d$/.test(e.code) ? e.code : e.key.toLowerCase());

export function mountGw(game: GwGame, root: HTMLElement): ArcadeInstance {
  const wrap = document.createElement('div');
  wrap.className = 'gw';
  wrap.innerHTML = `<div class="gw-unit"><div class="gw-loading">Вставляем батарейки…</div></div>
    <p class="gw-about"><b>${esc(game.model)} «${esc(game.title)}».</b> ${esc(game.about)}</p>
    <div class="gw-tools"><button class="btn small" data-a="acl" title="Кнопка ACL на обороте: сброс, как при замене батареек">Сброс</button></div>`;
  root.appendChild(wrap);
  const unit = wrap.querySelector('.gw-unit') as HTMLElement;

  let dead = false;
  let raf = 0;
  let machine: GwMachine | null = null;
  let beeper: Beeper | null = null;
  const segEls: Element[][] = Array.from({ length: 9 * 8 }, () => []);
  const shown = new Uint8Array(9 * 8);
  const held = new Map<string, number>(); // id кнопки → сколько источников держат (клавиша, палец)
  const btnEls = new Map<string, HTMLElement>();

  const save = () => {
    if (machine) store.set(saveKey(game.id), { m: machine.save(), at: Date.now() });
  };

  // прибор опрашивает кнопки не каждый такт: короткий тап (короче кадра) держим хотя бы MIN_HOLD
  const MIN_HOLD = CLOCK_HZ * 0.07;
  const downAt = new Map<string, number>();
  const pending = new Set<GwButton>();
  const press = (b: GwButton, down: boolean) => {
    const n = Math.max(0, (held.get(b.id) ?? 0) + (down ? 1 : -1));
    held.set(b.id, n);
    btnEls.get(b.id)?.classList.toggle('down', n > 0);
    if (!machine) return;
    if (n > 0) {
      pending.delete(b);
      downAt.set(b.id, machine.clocks);
      machine.set(b.port, b.mask, true);
    } else if (machine.clocks - (downAt.get(b.id) ?? -Infinity) < MIN_HOLD) pending.add(b);
    else machine.set(b.port, b.mask, false);
  };
  const releasePending = () => {
    for (const b of pending) {
      if (!machine || machine.clocks - (downAt.get(b.id) ?? 0) >= MIN_HOLD) {
        machine?.set(b.port, b.mask, false);
        pending.delete(b);
      }
    }
  };

  const onKey = (e: KeyboardEvent, down: boolean) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = keyOf(e);
    const b = game.buttons.find((x) => x.keys.includes(k));
    if (!b) return;
    e.preventDefault();
    if (down && e.repeat) return;
    const kk = `key:${k}`;
    if (down === keysDown.has(kk)) return;
    if (down) keysDown.add(kk);
    else keysDown.delete(kk);
    press(b, down);
  };
  const keysDown = new Set<string>();
  const kd = (e: KeyboardEvent) => onKey(e, true);
  const ku = (e: KeyboardEvent) => onKey(e, false);
  const releaseAll = () => {
    pending.clear();
    for (const b of game.buttons) {
      held.set(b.id, 0);
      machine?.set(b.port, b.mask, false);
      btnEls.get(b.id)?.classList.remove('down');
    }
    keysDown.clear();
  };
  const onHide = () => {
    if (document.hidden) {
      releaseAll();
      save();
    }
  };
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', save);

  (wrap.querySelector('[data-a=acl]') as HTMLButtonElement).onclick = () => {
    machine?.reset();
    save();
  };

  void (async () => {
    const [rom, svg, lay] = await Promise.all([
      fetch(base(game.id) + 'rom.bin').then((r) => r.arrayBuffer()),
      fetch(base(game.id) + 'screen.svg').then((r) => r.text()),
      fetch(base(game.id) + 'layout.json').then((r) => r.json() as Promise<Layout>),
    ]).catch((e) => {
      console.error(e);
      unit.innerHTML = '<div class="gw-loading">Не загрузилось — проверьте связь и откройте ещё раз.</div>';
      return [null, null, null] as const;
    });
    if (dead || !rom || !svg || !lay) return;

    const { w, h } = lay;
    unit.style.aspectRatio = `${w} / ${h}`;
    const box = (b: [number, number, number, number]) => `left:${pct(b[0], w)};top:${pct(b[1], h)};width:${pct(b[2], w)};height:${pct(b[3], h)}`;
    const sh = lay.shadow;
    unit.innerHTML = `<img class="gw-under" alt="" src="${base(game.id)}under.webp" style="${box(lay.under)}">
      ${sh ? `<div class="gw-screen gw-shadow" style="${box(sh.b)};opacity:${Math.min(0.12, sh.alpha * 1.6)}">${svg}</div>` : ''}
      <div class="gw-screen gw-lcd" style="${box(lay.screen)}">${svg}</div>
      <img class="gw-over" alt="" src="${base(game.id)}over.webp">`;

    unit.querySelectorAll('[data-s]').forEach((el) => {
      const [x, y, z] = (el.getAttribute('data-s') ?? '').split('.').map(Number);
      if (x < 9 && y < 4 && z < 2) segEls[segIndex(x, y, z)].push(el);
    });

    // кнопки: картинка нажатой из артворка, если есть, иначе — затемнение по кругу
    for (const b of game.buttons) {
      const art = lay.buttons.find((x) => x.port === b.port && x.mask === b.mask);
      const el = document.createElement('div');
      el.className = 'gw-btn' + (art ? ' art' : '');
      el.title = `${b.label}: ${b.keys.map((k) => (k === ' ' ? 'Пробел' : k.replace('arrow', '').replace('Numpad', 'цифр. '))).join(', ')}`;
      if (art) {
        el.setAttribute('style', box(art.b));
        el.innerHTML = `<img alt="" src="${base(game.id)}${art.img}">`;
      } else {
        const [cx, cy, r] = b.at;
        el.setAttribute('style', box([cx - r, cy - r, r * 2, r * 2]));
      }
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        press(b, true);
        const up = () => {
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          press(b, false);
        };
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      btnEls.set(b.id, el);
      unit.appendChild(el);
    }

    machine = new GwMachine(new Uint8Array(rom), { ba: game.buttons.some((b) => b.port === 'BA'), b: game.buttons.some((b) => b.port === 'B') });
    const saved = store.get<{ m: GwSave; at: number } | null>(saveKey(game.id), null);
    if (saved?.m) {
      try {
        machine.load(saved.m);
      } catch (e) {
        console.warn('elektronika: сохранение не подошло', e);
        machine.reset();
      }
    } else {
      // первые секунды после «вставки батареек» — без звука и экрана
      machine.skip(CLOCK_HZ / 2);
    }
    beeper = new Beeper(CLOCK_HZ);

    let last = performance.now();
    let carry = 0;
    let saveAt = last + 5000;
    const frame = (t: number) => {
      if (dead || !machine) return;
      const dt = Math.min(100, t - last);
      last = t;
      const want = (dt * CLOCK_HZ) / 1000 + carry;
      const n = Math.floor(want);
      if (n > 0) {
        const buf = new Float32Array(n + 8);
        const done = machine.run(n, buf);
        carry = want - done;
        if (beeper?.live) beeper.push(buf.slice(0, done));
        releasePending();
      } else carry = want;
      const lit = machine.lit;
      for (let i = 0; i < lit.length; i++) {
        if (lit[i] === shown[i]) continue;
        shown[i] = lit[i];
        for (const el of segEls[i]) el.classList.toggle('on', !!lit[i]);
      }
      if (t > saveAt) {
        saveAt = t + 5000;
        save();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  })();

  return {
    destroy() {
      save();
      dead = true;
      cancelAnimationFrame(raf);
      beeper?.close();
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', save);
      wrap.remove();
    },
  };
}
