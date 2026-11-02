/* «Коммерсы»: календарь и дорога, сделки и часы, исторические даты, падения, покупка клуба; партии ботов и прикидка баланса. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { CLUB_PRICE, LAST, dateText, mm, segMonths } from '../src/games/kommersy/data';
import { def } from '../src/games/kommersy/def';
import { choose } from '../src/games/kommersy/bot';
import { apply, clubReady, newState, view, worth, type Action, type State } from '../src/games/kommersy/engine';
import { botSeats, simulate } from './harness';

function act(s: State, seat: number, a: Action, rig?: number[]): State {
  const r = new RiggedRng(new SeededRng(7));
  r.rig(rig);
  const res = apply(s, seat, a, r);
  expect(res, JSON.stringify(a)).not.toBeNull();
  return res!.state;
}

describe('Коммерсы: календарь', () => {
  it('май 1988 → июль 2003, кризисы помесячно', () => {
    expect(dateText(0)).toBe('май 1988');
    expect(dateText(LAST)).toBe('июль 2003');
    expect(segMonths(0)).toBe(3);
    expect(segMonths(mm(1998, 8))).toBe(1);
    expect(segMonths(mm(1990, 11))).toBe(2); // отрезок не залезает в кризис января 1991
  });
});

describe('Коммерсы: ход', () => {
  it('бросок → игрок ставит фишку сам → клетка задаёт вопрос', () => {
    let s = newState([0, 1]);
    s = act(s, 0, { type: 'roll' }, [0]);
    expect(s.phase).toBe('move');
    s = act(s, 0, { type: 'move' }, [0, 15, 15]);
    expect(s.players[0].pos).toBe(1);
    expect(s.ask?.deals?.[0].id).toBe('deficit');
    expect(s.ask!.choices.at(-1)!.buy).toBe('pass');
    s = act(s, 0, { type: 'choose', i: 0 });
    expect(s.players[0].assets[0].name).toBe('Перепродажа дефицита');
    expect(s.players[0].cash).toBeLessThan(300);
    expect(s.turn).toBe(1);
  });

  it('дальше конца отрезка не уйти; дошли все — новый квартал, доходы и новая дорога', () => {
    let s = newState([0, 1]);
    s.players[0].pos = 6;
    s.players[1].pos = 7;
    const cash = s.players[0].cash;
    s = act(s, 0, { type: 'roll' }, [5]);
    s = act(s, 0, { type: 'move' });
    expect(s.m).toBe(3);
    expect(s.players.every((p) => p.pos === 0)).toBe(true);
    expect(s.players[0].cash).not.toBe(cash);
  });

  it('нет часов на своё дело — берётся с управляющим', () => {
    let s = newState([0]);
    s.players[0].job = { name: 'две работы', salary: 100, hours: 210 };
    s = act(s, 0, { type: 'roll' }, [0]);
    s = act(s, 0, { type: 'move' }, [0, 15, 15]);
    expect(s.ask!.deals![0].mgr).toBe(true);
    expect(s.ask!.choices[0].label).toContain('управляющ');
    s = act(s, 0, { type: 'choose', i: 0 });
    expect(s.players[0].assets[0].manager).toBe(true);
  });
});

describe('Коммерсы: эпоха и падения', () => {
  it('павловская реформа: неподготовленный теряет треть наличных, подготовленный — нет', () => {
    let s = newState([0, 1]);
    s.m = mm(1990, 10);
    s.len = 3;
    for (const p of s.players) {
      p.cash = 10000;
      p.job = null;
      p.pos = 7;
    }
    s.players[1].prep.push('pavlov');
    s.players[0].pos = 6;
    s = act(s, 0, { type: 'roll' }, [5]);
    s = act(s, 0, { type: 'move' });
    expect(s.fired).toContain('pavlov');
    expect(s.players[0].cash).toBeLessThan(s.players[1].cash * 0.8);
  });

  it('долги больше имущества — разорение и «Падал, но поднимался»: игра продолжается', () => {
    let s = newState([0]);
    s.players[0].cash = -50000;
    s.players[0].stats.name = 0;
    s.players[0].pos = 6;
    s = act(s, 0, { type: 'roll' }, [5]);
    s = act(s, 0, { type: 'move' });
    expect(s.players[0].falls.map((f) => f.kind)).toContain('razor');
    expect(s.players[0].cash).toBeGreaterThan(0);
    expect(s.phase).toBe('roll');
  });

  it('клуб: все условия — покупка на «Выходном» и конец партии', () => {
    let s = newState([0]);
    const p = s.players[0];
    Object.assign(p, { cash: CLUB_PRICE + 1e6, job: null, advisor: true });
    Object.assign(p.stats, { name: 80, svyazi: 80, heat: 0 });
    expect(clubReady(s, p)).toBe(true);
    s.cells[0] = 'rest';
    s = act(s, 0, { type: 'roll' }, [0]);
    s = act(s, 0, { type: 'move' }, [0]);
    expect(s.ask!.choices[0].buy).toBe('club');
    s = act(s, 0, { type: 'choose', i: 0 });
    expect(s.phase).toBe('over');
    expect(def.result(s)!.text).toContain('Лондон Юнайтед');
  });

  it('совесть и внимание органов соперникам не видны', () => {
    const s = newState([0, 1]);
    const v = view(s, [0]);
    expect(v.players[1].stats.heat).toBeUndefined();
    expect(v.players[1].stats.sovest).toBeUndefined();
    expect(v.my!.heatHint).toBeTruthy();
  });
});

describe('Коммерсы: партии ботов', () => {
  it('одиночные и сетевые партии доходят до июля 2003 или до клуба', async () => {
    for (const [n, seed] of [[1, 1], [3, 2], [6, 3]]) {
      const r = await simulate(def, botSeats(def, n, [0, 1, 2]), { start: 0, diff: 1, chance: 0 }, seed, 60000);
      expect(r.error).toBeUndefined();
      expect(r.finished).toBe(true);
    }
  }, 120000);

  it('прикидка баланса: Сложный один, 12 партий', () => {
    const rows: string[] = [];
    let clubs = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rng = new SeededRng(seed);
      const bot = new SeededRng(seed * 31);
      let s = newState([0], { diff: 1 }, ['kolyan'], rng);
      for (let i = 0; i < 20000 && s.phase !== 'over'; i++) {
        const a = choose(view(s, [0]), 0, 2, bot)!;
        s = apply(s, 0, a, rng)!.state;
      }
      const p = s.players[0];
      if (p.club) clubs++;
      rows.push(`${seed}: ${dateText(Math.min(s.m, LAST))} ${p.ending} капитал ${Math.round(worth(p)).toLocaleString('ru')} падений ${p.falls.length} имя ${p.stats.name} связи ${p.stats.svyazi} англ ${p.skills.english}`);
    }
    console.log(`клуб в ${clubs}/12\n` + rows.join('\n'));
    expect(rows.length).toBe(12);
  }, 120000);
});
