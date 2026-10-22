/* Китайский покер — пресеты, разделы правил с показом и строки журнала (без DOM). Подключаются в poker/def.ts. */
import type { Preset, RulesSection, SeatSpec } from '../../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../../cards/deck';
import { allCards } from '../hands';
import { newOState, ocfgFrom, OFC_NAME, type OEvent, type OState } from './engine';

export const OFC_PRESETS: Preset[] = [
  { id: 'ofcp', label: 'Китайский «Ананас»', hint: 'OFC Pineapple: 5 карт, потом 4 раза по 3 — две в ряды, одну в сброс; 2–3 игрока', options: { mode: 'ofcp', fant: 'on', deals: 6 } },
  { id: 'ofcprog', label: '«Ананас», прогрессивная фантазия', hint: 'Фантазия: QQ — 14 карт, KK — 15, AA — 16, сет — 17', options: { mode: 'ofcp', fant: 'prog', deals: 6 } },
  { id: 'ofc', label: 'Китайский классический', hint: 'OFC: 5 карт, потом по одной; до 4 игроков', options: { mode: 'ofc', fant: 'on', deals: 6 } },
];

const RANK: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В' };
const cn = (c: Card) => `<b>${RANK[c.r] ?? c.r}${SUIT_SYM[c.s]}</b>`;
const ROW_SHORT = ['вверх', 'в середину', 'вниз'];

export function describeOfc(ev: OEvent, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'odeal': {
      const f = ev.fant.map((n, p) => (n ? `${name(p)} (${n} карт)` : '')).filter(Boolean);
      return `Раздача ${ev.hand}. Первым раскладывает тот, кто слева от баттона (${name(ev.button)}).${f.length ? ` В фантазии: ${f.join(', ')}.` : ''}`;
    }
    case 'ocards':
      return null;
    case 'oplace': {
      if (ev.hidden) return `${name(ev.seat)} раскладывает фантазию рубашкой${ev.discard ? `, ${ev.discard} в сброс` : ''}`;
      const by = [0, 1, 2].map((r) => ev.put.filter((x) => x.row === r && x.card)).map((xs, r) => (xs.length ? `${xs.map((x) => cn(x.card!)).join(' ')} ${ROW_SHORT[r]}` : '')).filter(Boolean);
      return `${name(ev.seat)}: ${by.join(', ')}${ev.discard ? ` · ${ev.discard === 1 ? 'одну' : ev.discard} в сброс` : ''}`;
    }
    case 'oscore': {
      const sc = ev.score;
      const ps = Object.keys(sc.net).map(Number);
      const parts = ps.map((p) => {
        const roy = sc.roy[p].reduce((a, b) => a + b, 0);
        const n = sc.net[p];
        return `${name(p)} <b>${n > 0 ? '+' : ''}${n}</b>${sc.foul[p] ? ' (фол)' : roy ? ` (роялти ${roy})` : ''}`;
      });
      const f = ps.filter((p) => sc.next[p]).map((p) => `${name(p)} — ${sc.next[p]} карт`);
      return `🧮 Подсчёт раздачи ${ev.hand}: ${parts.join(', ')}.${f.length ? ` В фантазию: ${f.join(', ')}.` : ''}`;
    }
    case 'oend':
      return `🏁 Больше всех очков — у <b>${name(ev.winner)}</b>.`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14, T: 10 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const bots = (n: number): SeatSpec[] => ['Вовка', 'Ленка', 'Серёга'].slice(0, n).map((name, seat) => ({ seat, kind: 'bot', name, level: 1 }));

/** Позиция для показа: ряды и руки по местам, колода — сначала top, потом всё остальное по порядку. */
function opos(mode: 'ofc' | 'ofcp', p: { rows?: string[][]; held: string[]; top?: string; fant?: number[]; deals?: number; fantOpt?: string }): OState {
  const seats = p.held.map((_, i) => i);
  const s = newOState({ ...ocfgFrom({ mode, fant: p.fantOpt ?? 'on' }), deals: p.deals ?? 6 }, seats);
  s.hand = 1;
  s.button = seats[seats.length - 1];
  s.turn = 0;
  seats.forEach((i) => {
    s.rows[i] = (p.rows?.[i] ?? ['', '', '']).map(L);
    s.held[i] = L(p.held[i]);
  });
  if (p.fant) s.fant = [...p.fant, ...Array(9 - p.fant.length).fill(0)];
  if (s.rows.some((r) => r.some((x) => x.length))) s.round = 1;
  const top = L(p.top ?? '');
  const used = new Set([...s.rows.flat(2), ...s.held.flat(), ...top].map((c) => c.s + c.r));
  s.deck = [...top, ...allCards().filter((c) => !used.has(c.s + c.r))];
  return s;
}
const P = (seat: number, to: (0 | 1 | 2 | 'x')[], caption: string) => ({ seat, action: { type: 'place', to }, caption });

export const OFC_RULES: RulesSection[] = [
  {
    title: `${OFC_NAME.ofcp} (OFC)`,
    html: `<p>Ставок нет — играют на очки. У каждого <b>три ряда</b> открытыми картами: <b>верх</b> — 3 карты, <b>середина</b> — 5, <b>низ</b> — 5.
      Сначала сдают по пять карт — раскладываешь все. Потом четыре раза по три: <b>две кладёшь в ряды, третью — в сброс</b> рубашкой
      (её никто не видит). В <b>классическом</b> китайском покере после первых пяти сдают по одной, сброса нет.</p>
      <p>Раскладывают по очереди, слева от баттона, и видят ряды соперников. Переложить карту уже нельзя.</p>
      <p>Главное правило: ряды должны <b>усиливаться сверху вниз</b> — низ не слабее середины, середина не слабее верха.
      Иначе рука «мёртвая» — <b>фол</b>. Вверху считаются только старшая карта, пара и сет. Играют двое или трое
      (в «Ананасе» каждому нужно 17 карт — на четверых колоды не хватит), в классику — до четырёх.</p>`,
    demo: {
      seats: bots(2),
      setup: () => opos('ofcp', { held: ['AS AD 9C 7C 3H', 'KH QH JH 4S 4D'], top: '8C 2C KD TH 6D 5S' }),
      intro: 'По пять карт. Ленка на баттоне — первым раскладывает Вовка.',
      steps: [
        P(0, [2, 2, 1, 1, 0], 'Вовка: пара тузов — вниз, две трефы — в середину, тройку — наверх.'),
        P(1, [2, 2, 2, 1, 1], 'Ленка: К-Д-В червей — вниз (ждёт стрит-флеш), пару четвёрок — в середину.'),
        P(0, [1, 1, 'x'], 'Добор — три карты. Вовка кладёт обе трефы в середину (уже четыре трефы!), короля — в сброс рубашкой.'),
        P(1, [2, 0, 'x'], 'Ленка: десятку червей — вниз, шестёрку — наверх, пятёрку — в сброс.'),
      ],
    },
  },
  {
    title: 'Китайский покер: счёт и роялти',
    html: `<p>Когда у всех по 13 карт, каждый сравнивает ряды с каждым соперником: по <b>очку за выигранный ряд</b> (поровну — 0), и ещё
      <b>+3 за «скуп»</b> — если выиграл все три ряда (итого 6). Сверху — <b>роялти</b>, премии за сильные ряды; соперники платят разницу.</p>
      <table class="pk-roy"><tr><th>Ряд</th><th>Роялти</th></tr>
      <tr><td>Низ</td><td>стрит 2, флеш 4, фулл-хаус 6, каре 10, стрит-флеш 15, роял 25</td></tr>
      <tr><td>Середина</td><td>сет 2, стрит 4, флеш 8, фулл-хаус 12, каре 20, стрит-флеш 30, роял 50</td></tr>
      <tr><td>Верх</td><td>пара шестёрок 1, семёрок 2 … тузов 9; сет двоек 10, троек 11 … тузов 22</td></tr></table>
      <p><b>Фол</b> — проигрыш всех трёх рядов (6 очков) и роялти соперника, свои роялти сгорают. Фол у обоих — ничья.
      Партия — несколько раздач, побеждает тот, у кого больше очков.</p>`,
    demo: {
      seats: bots(2),
      setup: () =>
        opos('ofc', {
          rows: [
            ['9S 9H 2C', 'KC KD 5S 5H 3D', '7H 8H JH 2H'],
            ['AS AC 3S', '6C 6D QD 8C', 'TS TD 7S 7C 2D'],
          ],
          held: ['4H', '4D'],
          deals: 1,
          fantOpt: 'off',
        }),
      intro: 'Классический китайский: у обоих по 12 карт, осталось по одной.',
      steps: [
        P(0, [2], 'Вовка кладёт червовую четвёрку вниз — флеш (роялти 4), да вверху пара девяток (ещё 4).'),
        P(1, [1], 'Ленка жадничала: тузы вверху, а в середине только пара шестёрок — фол! Вовка получает 6 за ряды и свои роялти — 14 очков.'),
      ],
    },
  },
  {
    title: 'Фантазия',
    html: `<p>Собрал вверху <b>пару дам или старше</b> и не сфолил — следующая раздача у тебя <b>фантазия</b>: все карты сразу
      (в «Ананасе» 14, одну в сброс; в классике 13), раскладываешь рубашкой, соперники увидят ряды только на подсчёте.</p>
      <p>В <b>прогрессивной</b> фантазии чем сильнее верх, тем больше карт: QQ — 14, KK — 15, AA — 16, сет — 17.</p>
      <p>Фантазия <b>продолжается</b>, если в ней же собрал сет вверху, фулл-хаус или старше в середине или каре и старше внизу.</p>`,
    demo: {
      seats: bots(2),
      setup: () => opos('ofcp', { held: ['AH KH QH JH TH 9S 9D 9C 4S 4D 2C 2D 7S 3H', 'AS KS 8D 8H 5C'], fant: [14, 0] }),
      intro: 'Вовка в фантазии: ему сразу 14 карт. Ленка играет обычно — пять.',
      steps: [
        P(0, [2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0, 'x'], 'Вовка: роял-флеш вниз (25), фулл-хаус в середину (12), пару двоек наверх. Фулл в середине — фантазия продолжится.'),
        P(1, [2, 2, 1, 1, 0], 'Ленка раскладывает свои пять как обычно — ряды Вовки ей пока не видны.'),
      ],
    },
  },
];
