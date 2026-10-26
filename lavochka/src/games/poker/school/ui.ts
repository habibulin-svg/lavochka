/* Школа покера — вкладка «Школа» в лобби и окно урока. Путь из 12 уроков (порядок — подсказка, любой урок открыт),
 * разряд по звёздам. Урок: шаги на настоящем 2D-столе (раздачи — school/scene.ts, «▶ Показать» играет ходы движком) →
 * «Запомни» → задачи «твой ход?» (ответ сверяется с расчётом school/solve.ts, после — объяснение и сам расчёт) → итог,
 * звёзды и игра-закрепление против ботов нужного стиля (стиль бота закреплён за местом — profiles.SEAT_PROFILE). */
import { Sound } from '../../../core/audio';
import { SeededRng } from '../../../core/rng';
import { settings } from '../../../core/settings';
import type { Options } from '../../../core/types';
import { modal } from '../../../core/ui';
import { esc, h, sleep } from '../../../core/util';
import type { GameView, LaunchTable, ViewCtx } from '../../../core/view';
import { syncPoker } from '../cloud';
import { def, SEATS } from '../def';
import { apply, makeView, type State } from '../engine';
import { SEAT_PROFILE, type ProfileId } from '../profiles';
import { createView } from '../view';
import { loadSchool, rankOf, recordLesson, startPending, starsFor, type SchoolProgress } from './progress';
import { buildScene, toAction } from './scene';
import { seatName, solve, type Solved } from './solve';
import type { Lesson, LessonGame, Task } from './types';
import './school.css';

type Launch = (options: Options, table?: LaunchTable) => void;

const FILES = import.meta.glob<Lesson>('./lessons/*.json', { import: 'default' });
let all: Promise<Lesson[]> | null = null;
export const loadLessons = () =>
  (all ??= Promise.all(
    Object.keys(FILES)
      .sort()
      .map((k) => FILES[k]()),
  ));

const stars = (n: number) => `<span class="pks-stars" aria-label="${n} из 3">${'★'.repeat(n)}${'☆'.repeat(3 - n)}</span>`;

// ---------------------------------------------------------------- вкладка

export function renderSchool(box: HTMLElement, launch: Launch) {
  box.innerHTML = '<p class="pks-wait">Открываю школу…</p>';
  const draw = (lessons: Lesson[]) => {
    const p = loadSchool();
    const r = rankOf(p);
    const next = lessons.find((l) => !p.lessons[l.id]?.stars);
    box.innerHTML = `<div class="pks">
      <div class="pks-head">
        <div><b class="pks-rank">${esc(r.name)}</b><small>${r.stars} ★ из ${lessons.length * 3}${r.next ? ` · до «${esc(r.next[1])}» — ${r.next[0] - r.stars} ★` : ''}</small></div>
        <div class="pks-bar"><i style="width:${Math.round((r.stars / (lessons.length * 3)) * 100)}%"></i></div>
      </div>
      <p class="pks-about">Ответы задач проверяются расчётом — Нэш, ICM, шансы. Порядок — совет: любой урок можно открыть сразу.</p>
      <ol class="pks-path">${lessons
        .map((l) => {
          const m = p.lessons[l.id];
          return `<li><button type="button" class="pks-item ${m?.stars ? 'done' : ''} ${l === next ? 'next' : ''}" data-id="${esc(l.id)}">
            <span class="pks-n">${l.n}</span><span class="pks-t"><b>${esc(l.title)}</b><small>${esc(l.goal)}</small></span>
            <span class="pks-m">${m?.stars ? stars(m.stars) : l === next ? '<em>дальше</em>' : ''}${m?.played ? '<small title="Игра-закрепление сыграна">🃏 ✓</small>' : ''}</span></button></li>`;
        })
        .join('')}</ol></div>`;
    for (const b of box.querySelectorAll<HTMLButtonElement>('.pks-item'))
      b.onclick = () => {
        const l = lessons.find((x) => x.id === b.dataset.id)!;
        openLesson(l, launch, () => draw(lessons));
      };
  };
  void loadLessons().then((ls) => {
    draw(ls);
    // профиль новее — перерисовать с ним
    void syncPoker().then((changed) => changed && draw(ls));
  });
}

// ---------------------------------------------------------------- стол урока

/** Снимок для стола урока: open — руки всех живых лицом (2D-стол открывает чужие карты только на вскрытии — через shown). */
function viewOf(s: State, hero: number, open: boolean) {
  const v = makeView(s, open ? 'all' : [hero]);
  if (open) v.shown = { ...v.shown, ...Object.fromEntries(s.inHand.filter((p) => !s.folded[p] && p !== hero && v.hole[p]?.length).map((p) => [p, v.hole[p]])) };
  return v;
}

class Table {
  view: GameView;
  el: HTMLElement;
  private hero = 0;
  constructor() {
    this.el = h('<div class="pks-table"><div class="pks-board"></div><div class="pks-ctl" hidden></div></div>');
    this.view = createView(null);
    const ctx: ViewCtx = {
      act: () => {},
      mySeats: [],
      demo: true,
      controls: this.el.querySelector('.pks-ctl') as HTMLElement,
      name: (seat) => `<span class="nm" style="--c:${SEATS[seat]?.ink ?? SEATS[seat]?.color}">${esc(seatName(seat, this.hero))}</span>`,
      speed: () => settings.speed,
      autoSingle: () => false,
    };
    this.view.mount(this.el.querySelector('.pks-board') as HTMLElement, ctx);
  }
  show(s: State, hero: number, open: boolean) {
    this.hero = hero;
    this.view.setView(viewOf(s, hero, open));
    this.view.setTurn(s.over ? [] : [s.turn], []);
  }
  destroy() {
    this.view.destroy?.();
  }
}

// ---------------------------------------------------------------- урок

/** Стол перед шагом i: последний стол до него и все ходы показа между ними. */
function stateAt(l: Lesson, i: number): { s: State; hero: number; open: boolean } | null {
  let k = i;
  while (k >= 0 && !l.steps[k].scene) k--;
  if (k < 0) return null;
  const sc = l.steps[k].scene!;
  const b = buildScene(sc);
  let s = b.s;
  const rng = new SeededRng(13);
  for (let j = k; j < i; j++) for (const p of l.steps[j].play ?? []) s = apply(s, p.act[0], toAction(p.act), rng)?.state ?? s;
  return { s, hero: b.hero, open: !!sc.open };
}

/** Что показать в задаче без стола: стеки и выплаты, цифры HUD. */
function taskInfo(t: Task): string {
  const rows: string[] = [];
  if (t.stacks) rows.push(`<p><b>Стеки:</b> ${t.stacks.map((x, i) => `${esc(seatName(i, 0))} — ${x.toLocaleString('ru-RU')}`).join(', ')}</p>`);
  if (t.prizes) {
    const pool = t.prizes.reduce((a, x) => a + x, 0);
    rows.push(`<p><b>Призы:</b> ${t.prizes.map((x, i) => `${i + 1}-е — ${Math.round((x / pool) * 100)}%`).join(', ')}</p>`);
  }
  if (t.hud) rows.push(`<p class="pks-hud"><span>Раздач <b>${t.hud.hands}</b></span><span>VPIP <b>${t.hud.vpip}</b></span><span>PFR <b>${t.hud.pfr}</b></span><span>AF <b>${t.hud.af}</b></span></p>`);
  return rows.join('');
}

export function openLesson(l: Lesson, launch: Launch, onClose: () => void) {
  const root = h(`<div class="pks-lesson">
    <div class="pks-top"><b>${l.n}. ${esc(l.title)}</b><span class="pks-dots"></span></div>
    <div class="pks-main"><div class="pks-text"></div><div class="pks-side"></div></div>
    <div class="pks-nav"></div></div>`);
  const dots = root.querySelector('.pks-dots') as HTMLElement;
  const text = root.querySelector('.pks-text') as HTMLElement;
  const side = root.querySelector('.pks-side') as HTMLElement;
  const nav = root.querySelector('.pks-nav') as HTMLElement;
  const table = new Table();
  side.appendChild(table.el);
  let token = 0;
  // мимо окна урок не закрывается (легко промахнуться на телефоне); крестик и Esc — через close: стол убрать, путь перерисовать
  const m = modal(root, [], { wide: true, cls: 'pks-modal', dismiss: false });
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  const close = () => {
    token++;
    document.removeEventListener('keydown', onKey);
    table.destroy();
    m.close();
    onClose();
  };
  document.addEventListener('keydown', onKey);
  const x = h('<button type="button" class="pks-close" title="Закрыть урок" aria-label="Закрыть урок">✕</button>');
  x.onclick = close;
  root.querySelector('.pks-top')!.appendChild(x);

  const btn = (label: string, cls: string, f: () => void) => {
    const b = h(`<button type="button" class="btn ${cls}">${label}</button>`) as HTMLButtonElement;
    b.onclick = () => {
      Sound.ui();
      f();
    };
    nav.appendChild(b);
    return b;
  };
  const setDots = (phase: 'step' | 'mem' | 'task' | 'end', i: number) => {
    const total = l.steps.length + 1 + l.tasks.length + 1;
    const at = phase === 'step' ? i : phase === 'mem' ? l.steps.length : phase === 'task' ? l.steps.length + 1 + i : total - 1;
    dots.innerHTML = `<i style="width:${Math.round(((at + 1) / total) * 100)}%"></i>`;
    dots.title = phase === 'task' ? `Задача ${i + 1} из ${l.tasks.length}` : phase === 'step' ? `Шаг ${i + 1} из ${l.steps.length}` : '';
  };

  // ---- шаги
  const step = (i: number) => {
    token++;
    const my = token;
    setDots('step', i);
    const st = l.steps[i];
    const at = stateAt(l, i);
    side.hidden = !at;
    if (at) table.show(at.s, at.hero, at.open);
    text.innerHTML = `<p class="pks-kicker">Шаг ${i + 1} из ${l.steps.length}</p><div class="pks-say">${st.text}</div><p class="pks-cap" aria-live="polite"></p>`;
    const cap = text.querySelector('.pks-cap') as HTMLElement;
    nav.innerHTML = '';
    btn('← Назад', '', () => (i ? step(i - 1) : close())).disabled = false;
    if (st.play?.length && at) {
      const pb = btn('▶ Показать', 'pks-play', async () => {
        pb.disabled = true;
        let s = stateAt(l, i)!.s;
        table.show(s, at.hero, at.open);
        const rng = new SeededRng(13);
        for (const p of st.play!) {
          const r = apply(s, p.act[0], toAction(p.act), rng);
          if (!r || my !== token) return;
          s = r.state;
          if (p.caption) cap.textContent = p.caption;
          await table.view.play(r.events, viewOf(s, at.hero, at.open));
          if (my !== token) return;
          await sleep(900 / settings.speed);
        }
        if (my === token) {
          pb.disabled = false;
          pb.textContent = '⟲ Ещё раз';
        }
      });
    }
    btn(i + 1 < l.steps.length ? 'Дальше →' : 'Запомни →', 'primary', () => (i + 1 < l.steps.length ? step(i + 1) : memo()));
  };

  // ---- «Запомни»
  const memo = () => {
    token++;
    setDots('mem', 0);
    side.hidden = true;
    text.innerHTML = `<p class="pks-kicker">Запомни</p><ul class="pks-remember">${l.remember.map((r) => `<li>${r}</li>`).join('')}</ul>
      <p class="pks-hint">Дальше — ${l.tasks.length} задач «твой ход?». Ответ проверяется расчётом; ошибка — не беда, после каждой задачи — разбор.</p>`;
    nav.innerHTML = '';
    btn('← Назад', '', () => step(l.steps.length - 1));
    btn('К задачам →', 'primary', () => task(0));
  };

  // ---- задачи
  let mistakes = 0;
  const task = (j: number) => {
    token++;
    if (j === 0) mistakes = 0;
    setDots('task', j);
    const t = l.tasks[j];
    const b = t.scene ? buildScene(t.scene) : null;
    side.hidden = !b;
    // вскрытие («кто выиграет») — карты всех на виду, иначе задачу не решить
    const showdown = t.kind === 'winner' || t.kind === 'winlow';
    if (b) table.show(b.s, b.hero, showdown || !!t.scene!.open);
    const sol: Solved = solve(t);
    text.innerHTML = `<p class="pks-kicker">Задача ${j + 1} из ${l.tasks.length} · твой ход?</p><div class="pks-say">${t.q}</div>${taskInfo(t)}
      <div class="pks-opts">${sol.options.map(([v, lab]) => `<button type="button" class="btn pks-opt" data-v="${esc(v)}">${esc(lab)}</button>`).join('')}</div>
      <div class="pks-why" hidden></div>`;
    nav.innerHTML = '';
    const why = text.querySelector('.pks-why') as HTMLElement;
    const opts = [...text.querySelectorAll<HTMLButtonElement>('.pks-opt')];
    for (const o of opts)
      o.onclick = () => {
        const ok = o.dataset.v === sol.answer;
        if (!ok) mistakes++;
        Sound.ui();
        for (const x of opts) {
          x.disabled = true;
          x.classList.toggle('right', x.dataset.v === sol.answer);
        }
        if (!ok) o.classList.add('wrong');
        why.hidden = false;
        why.innerHTML = `<p class="pks-verdict ${ok ? 'ok' : 'bad'}">${ok ? '✓ Верно!' : `✗ Не так. Верно — «${esc(sol.options.find(([v]) => v === sol.answer)?.[1] ?? sol.answer)}».`}</p><p>${t.why}</p><p class="pks-calc">🧮 ${sol.facts}</p>`;
        // после ответа — карты соперников, если их видно в разборе
        if (b && t.scene && !t.scene.open && t.kind === 'outs') table.show(b.s, b.hero, true);
        nav.innerHTML = '';
        btn(j + 1 < l.tasks.length ? 'Следующая →' : 'Итог →', 'primary', () => (j + 1 < l.tasks.length ? task(j + 1) : end()));
        why.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
    btn('← К уроку', '', () => step(0));
  };

  // ---- итог
  const end = () => {
    token++;
    setDots('end', 0);
    side.hidden = true;
    const p: SchoolProgress = recordLesson(l.id, l.tasks.length, mistakes);
    const got = p.lessons[l.id].stars;
    const n = starsFor(mistakes);
    const r = rankOf(p);
    text.innerHTML = `<p class="pks-kicker">Урок пройден</p>
      <p class="pks-big">${stars(n)}</p>
      <p>Задач верно с первого раза: <b>${l.tasks.length - mistakes}</b> из ${l.tasks.length}.${got > n ? ` Лучший результат — ${got} ★.` : ''} Разряд: <b>${esc(r.name)}</b> (${r.stars} ★).</p>
      <div class="pks-game"><p><b>Закрепление.</b> ${esc(l.game.text)}</p><p class="pks-hint">${esc(gameLine(l.game))}</p></div>`;
    nav.innerHTML = '';
    btn('Решить ещё раз', '', () => task(0));
    btn('К пути', '', close);
    btn('🃏 Сыграть', 'primary', () => {
      // засчитается, когда партия будет доиграна
      startPending(l.id);
      close();
      startGame(l.game, launch);
    });
  };

  step(0);
}

// ---------------------------------------------------------------- игра-закрепление

const PROFILE_RU: Record<ProfileId, string> = { tag: 'регуляр', lag: 'LAG', nit: 'нит', station: 'колл-станция', maniac: 'маньяк', fish: 'новичок' };

function gameLine(g: LessonGame): string {
  const who = g.bots.map((b) => PROFILE_RU[b]).join(', ');
  const lvl = ['лёгкие', 'средние', 'сложные'][g.level ?? 1];
  if (g.kind === 'sng') return `Sit&Go ${g.tour === 'hu' ? 'вдвоём' : `на ${g.bots.length + 1}`}, ${g.speed === 'hyper' ? 'гипер' : g.speed === 'normal' ? 'обычный' : 'турбо'}; боты ${lvl}.`;
  return `Быстрая игра: ${g.hands ?? 30} раздач, соперники — ${who} (${lvl}).`;
}

/** Места под стили: человек — место 0, бот каждого стиля — первое свободное место с этим стилем. */
export function seatsFor(bots: ProfileId[]): number[] {
  const out = [0];
  for (const b of bots) {
    const p = SEAT_PROFILE.findIndex((x, i) => i > 0 && x === b && !out.includes(i));
    const any = SEAT_PROFILE.findIndex((_, i) => i > 0 && !out.includes(i));
    out.push(p >= 0 ? p : any);
  }
  return out.filter((x) => x >= 0).sort((a, b) => a - b);
}

export function startGame(g: LessonGame, launch: Launch) {
  const mode = g.mode ?? 'holdem';
  const base = def.presets?.find((p) => p.options.mode === mode && !p.options.hilo)?.options ?? { mode };
  const level = g.level ?? 1;
  if (g.kind === 'sng') {
    const count = g.tour === 'hu' ? 2 : g.bots.length + 1;
    launch({ ...base, mode, tour: g.tour ?? 'sng6', speed: g.speed ?? 'turbo', tkind: 'freeze', late: false, bank: false, buyin: 100 }, { count, levels: Array(count).fill(level) });
    return;
  }
  const seats = seatsFor(g.bots);
  launch({ ...base, mode, hands: g.hands ?? 30, stack: g.stack ?? 1000, every: 10 }, { count: seats.length, seats, levels: seats.map(() => level) });
}
