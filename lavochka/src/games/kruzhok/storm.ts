/* «Штурм» — задачи на время: три минуты, задачи от лёгких ко всё более трудным, ошибка — минус 10 секунд и
 * следующая задача. Рейтинг не трогает (рейтинг — за обдуманное решение в «Задачах»); рекорд — на устройстве,
 * за новый рекорд — звёзды кружка. */
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { h, sleep } from '../../core/util';
import { Board } from '../chess/board';
import { play, type Move, type State } from '../chess/engine';
import { checkMark, fromUci, position, toUci } from '../chess/notation';
import { loadPuzzles, type Puzzle } from './data';
import { addStars } from './path';
import { touch } from './cloud';

const TIME = 180;
const PENALTY = 10;
const BEST = 'kruzhok.storm';

/** Рейтинг i-й задачи штурма: от 600, шаг 50 — к двадцатой уже около 1600. */
export const stormRating = (i: number) => Math.min(2600, 600 + i * 50);

export function mountStorm(stage: HTMLElement, panel: HTMLElement) {
  const host = h('<div class="kz-host"></div>');
  stage.appendChild(host);
  const board = new Board(host);
  let alive = true;
  let all: Puzzle[] = [];
  const used = new Set<string>();
  let pz: Puzzle | null = null;
  let pos: State = position();
  let ply = 0;
  let i = 0;
  let solved = 0;
  let combo = 0;
  let bestCombo = 0;
  let left = TIME;
  let timer = 0;
  let gen = 0;
  let running = false;

  const el = h(`<div class="kz-tr kz-storm">
    <div class="kz-rank"><b>⚡ Штурм</b><br><small>Три минуты. Задачи всё труднее, ошибка — минус ${PENALTY} секунд. Рейтинг не меняется.</small></div>
    <div class="kz-storm-clock" aria-live="off">3:00</div>
    <div class="kz-storm-score"><span>Решено: <b class="kz-st-n">0</b></span><span>Серия: <b class="kz-st-c">0</b></span></div>
    <div class="kz-msg" aria-live="polite"></div>
    <div class="kz-btns"></div>
  </div>`);
  panel.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const say = (html: string, kind: 'ok' | 'bad' | 'info' = 'info') => {
    const m = q('.kz-msg');
    m.className = `kz-msg kz-${kind}`;
    m.innerHTML = html;
  };
  const buttons = (list: { text: string; primary?: boolean; on: () => void }[]) => {
    const box = q('.kz-btns');
    box.innerHTML = '';
    for (const b of list) {
      const x = h<HTMLButtonElement>(`<button class="btn${b.primary ? ' primary' : ''}">${b.text}</button>`);
      x.onclick = () => (Sound.ui(), b.on());
      box.appendChild(x);
    }
  };
  const clock = () => {
    const t = Math.max(0, left);
    q('.kz-storm-clock').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    q('.kz-storm-clock').classList.toggle('low', t <= 20);
    q('.kz-st-n').textContent = String(solved);
    q('.kz-st-c').textContent = String(combo);
  };

  const pick = (): Puzzle | null => {
    const r = stormRating(i);
    // короткие задачи (до трёх своих ходов) — на скорость, а не на долгий счёт
    for (const w of [80, 160, 320, 3000]) {
      const near = all.filter((p) => !used.has(p.id) && p.moves.length <= 6 && Math.abs(p.rating - r) <= w);
      if (near.length) return near[Math.floor(Math.random() * near.length)];
    }
    return null;
  };

  const next = async () => {
    const my = ++gen;
    board.input(null);
    board.draw();
    pz = pick();
    if (!pz) return stop();
    used.add(pz.id);
    i++;
    pos = position(pz.fen);
    ply = 0;
    board.flip(pos.turn === 0);
    board.set(pos);
    await sleep(250);
    if (!alive || my !== gen || !running) return;
    const m = fromUci(pos, pz.moves[0]);
    if (!m) return void next();
    move(m);
    ply = 1;
    say(`Задача ${i} · рейтинг ${pz.rating}. Ход ${pos.turn === 0 ? 'белых' : 'чёрных'}.`);
    board.input(pos.turn, onPlayer);
  };

  const move = (m: Move) => {
    m.captured ? Sound.capture() : Sound.place();
    pos = play(pos, m);
    board.set(pos, { from: m.from, to: m.to });
  };

  const onPlayer = async (m: Move) => {
    if (!running || !pz) return;
    const my = gen;
    const mate = checkMark(pos, m) === '#';
    if (toUci(m) !== pz.moves[ply] && !mate) {
      Sound.nomove();
      left -= PENALTY;
      combo = 0;
      clock();
      say(`Мимо — минус ${PENALTY} секунд.`, 'bad');
      board.input(null);
      board.draw([], [{ sq: m.to, kind: 'bad' }]);
      await sleep(500);
      if (alive && my === gen && running) void next();
      return;
    }
    move(m);
    ply++;
    if (mate || ply >= pz.moves.length) {
      solved++;
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      clock();
      Sound.beep(1320, 0.07, 0.12);
      say('Верно!', 'ok');
      return void next();
    }
    board.input(null);
    await sleep(200);
    if (!alive || my !== gen || !running) return;
    const r = fromUci(pos, pz.moves[ply]);
    if (!r) return void next();
    move(r);
    ply++;
    board.input(pos.turn, onPlayer);
  };

  const tick = () => {
    left--;
    clock();
    if (left <= 0) stop();
  };

  const start = () => {
    used.clear();
    i = 0;
    solved = 0;
    combo = 0;
    bestCombo = 0;
    left = TIME;
    running = true;
    clock();
    clearInterval(timer);
    timer = window.setInterval(tick, 1000);
    buttons([{ text: '■ Закончить', on: stop }]);
    void next();
  };

  const stop = () => {
    if (!running) return;
    running = false;
    gen++;
    clearInterval(timer);
    board.input(null);
    const best = store.get<number>(BEST, 0);
    const record = solved > best;
    if (record) {
      store.set(BEST, solved);
      touch();
      if (solved >= 5) addStars(10, 'новый рекорд штурма');
    }
    record ? Sound.win() : Sound.turn();
    say(`<b>${left > 0 ? "Штурм окончен." : "Время!"}</b> Решено задач: ${solved}, лучшая серия — ${bestCombo}. ${record ? '<b>Новый рекорд!</b>' : `Рекорд — ${best}.`}`, record ? 'ok' : 'info');
    buttons([{ text: '⚡ Ещё штурм', primary: true, on: start }]);
  };

  say(`${store.get<number>(BEST, 0) ? `Твой рекорд — ${store.get<number>(BEST, 0)} задач. ` : ''}Загружаю задачи…`);
  board.set(position());
  void loadPuzzles()
    .then((p) => {
      if (!alive) return;
      all = p;
      const best = store.get<number>(BEST, 0);
      say(`${best ? `Твой рекорд — ${best} задач. ` : ''}Решай быстро: первая задача — в один-два хода, дальше труднее.`);
      buttons([{ text: '⚡ Начать штурм', primary: true, on: start }]);
    })
    .catch(() => say('Не удалось загрузить задачи. Проверьте связь и откройте раздел ещё раз.', 'bad'));

  return {
    destroy() {
      alive = false;
      running = false;
      clearInterval(timer);
      board.destroy();
      host.remove();
      el.remove();
    },
  };
}

export const stormBest = () => store.get<number>(BEST, 0);
