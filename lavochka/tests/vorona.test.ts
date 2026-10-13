/* «Белая ворона»: колоды, День Белой Вороны, почта, бизнес и клиент, линька; партии ботов на обоих изданиях. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { BIZ, CELLS, MAIL } from '../src/games/vorona/data';
import { def } from '../src/games/vorona/def';
import { apply, newState, type Action, type State } from '../src/games/vorona/engine';
import { botSeats, defaults, simulate } from './harness';

const rng = () => new RiggedRng(new SeededRng(3));

function act(s: State, seat: number, a: Action, rig?: number[]): State {
  const r = rng();
  r.rig(rig);
  const res = apply(s, seat, a, r);
  expect(res, JSON.stringify(a)).not.toBeNull();
  return res!.state;
}

const mailId = (start: string) => MAIL.findIndex((m) => m.text.startsWith(start) || m.who.startsWith(start));

describe('Белая ворона', () => {
  it('колоды: 64 карточки «Почты», по 15 бизнесов; поле — 32 клетки, День Белой Вороны — 31-я', () => {
    expect(MAIL.length).toBe(64);
    expect(MAIL.filter((m) => m.kind === 'risk').length).toBe(4);
    expect(BIZ.blue.length).toBe(15);
    expect(BIZ.green.length).toBe(15);
    expect(CELLS.blue.length).toBe(32);
    expect(CELLS.green[31].kind).toBe('payday');
    expect(CELLS.green[27].kind).toBe('molt');
  });

  it('счёт ждёт Дня Белой Вороны; там зарплата, 20 % займа и счета, нехватка — в долг', () => {
    let s = newState('blue', [0, 1], 2, rng());
    const id = mailId('Доставка нового меха');
    s.mail = [id, ...s.mail.filter((i) => i !== id)];
    s = act(s, 0, { type: 'roll' }, [0]);
    expect(s.bills[0]).toEqual([id]);
    expect(s.cash[0]).toBe(325);
    s.turn = s.actor = 0;
    s.phase = 'roll';
    s.pos[0] = 28;
    s = act(s, 0, { type: 'roll' }, [5]); // 6 очков, но стоп на 31-м
    expect(s.pos[0]).toBe(31);
    expect(s.phase).toBe('payday');
    // 325 + 325 − 800 = −150 → заём 150
    expect(s.cash[0]).toBe(0);
    expect(s.bank[0]).toBe(-150);
    expect(apply(s, 0, { type: 'bank', n: 100 }, rng())).toBeNull(); // наличных нет
    s = act(s, 0, { type: 'done' });
    expect(s.pos[0]).toBe(0);
    expect(s.month[0]).toBe(1);
    expect(s.mail[s.mail.length - 1]).toBe(id);
  });

  it('бизнес: купить, продать клиенту, комиссионные — тому, кто выбросит больше', () => {
    let s = newState('blue', [0, 1, 2], 2, rng());
    s.bizDeck = [8, ...s.bizDeck.filter((i) => i !== 8)]; // «Ягуар» 950 / 1400 / 95
    s = act(s, 0, { type: 'roll' }, [3]);
    expect(s.phase).toBe('biz');
    s = act(s, 0, { type: 'buy' });
    expect(s.bank[0]).toBe(-625);
    s.turn = s.actor = 0;
    s.phase = 'roll';
    s = act(s, 0, { type: 'roll' }, [4]);
    expect(s.phase).toBe('client');
    s = act(s, 0, { type: 'sell', i: 0 }, [2, 5]);
    expect(s.cash[0]).toBe(1400);
    expect(s.cash[2]).toBe(325 + 95);
  });

  it('вне Дня Белой Вороны вклад не тронуть, взять в долг можно', () => {
    const s = newState('blue', [0, 1], 2, rng());
    expect(apply(s, 0, { type: 'bank', n: 100 }, rng())).toBeNull();
    const t = act(s, 0, { type: 'bank', n: -100 });
    expect(t.bank[0]).toBe(-100);
    expect(t.cash[0]).toBe(425);
  });

  it('ветеринарное страхование гасит ветеринарные счета', () => {
    let s = newState('blue', [0, 1], 2, rng());
    const vet = mailId('Ветеринарное');
    const bill = mailId('Вам пришили оторванный хвост');
    s.mail = [vet, bill, ...s.mail.filter((i) => i !== vet && i !== bill)];
    s = act(s, 0, { type: 'roll' }, [0]);
    s = act(s, 0, { type: 'buy' });
    expect(s.vet[0]).toBe(true);
    s.turn = s.actor = 0;
    s.phase = 'roll';
    s = act(s, 0, { type: 'roll' }, [1]); // 1 → 3, «Почта»
    expect(s.bills[0]).toEqual([]);
  });

  it('линька: все на квадрат назад, у стоящего на старте — 325 попавшему', () => {
    let s = newState('blue', [0, 1, 2], 2, rng());
    s.pos = [19, 10, 0, 0, 0, 0];
    s = act(s, 0, { type: 'roll' }, [0]);
    expect(s.pos.slice(0, 3)).toEqual([19, 9, 0]);
    expect(s.cash[0]).toBeGreaterThanOrEqual(650);
  });
});

describe('партии ботов', () => {
  for (const variant of ['blue', 'green']) {
    it(`${variant}: доигрывают на 2–6 игроках`, async () => {
      for (let n = 2; n <= 6; n++) {
        const res = await simulate(def, botSeats(def, n, [0, 1, 2]), { ...defaults(def), variant, months: 2 }, 900 + n);
        expect(res.error, `${n} игроков`).toBeUndefined();
        expect(res.finished, `${n} игроков: ${res.steps} шагов`).toBe(true);
      }
    }, 60_000);
  }
});
