/* Гадание: справочник значений, расклады, тасовка, итоги «да/нет» и «на желание», адреса страниц карт. */
import { describe, expect, it } from 'vitest';
import { isMajor, tarotName, TAROT_SIZE } from '../src/cards/tarot';
import { SeededRng } from '../src/core/rng';
import { cardPath, parseGadanie, MODES, GADANIE_PATH } from '../src/games/gadanie/pages';
import { KARTY, KARTY36, kartaMeaning, shuffleDeck, slotsOf, TARO, verdictOf, type Drawn } from '../src/games/gadanie/reading';
import { SPREADS, spreadById, spreadSize } from '../src/games/gadanie/spreads';

describe('справочник', () => {
  it('таро: 78 карт, имена как в колоде, все поля заполнены', () => {
    expect(TARO).toHaveLength(TAROT_SIZE);
    TARO.forEach((m, c) => {
      expect(m.name, `карта ${c}`).toBe(tarotName(c));
      for (const k of ['pic', 'upText', 'downText', 'love', 'work', 'advice'] as const) expect(m[k].length, `${m.name}: ${k}`).toBeGreaterThan(10);
      expect(m.up.length).toBeGreaterThanOrEqual(3);
      expect(m.down.length).toBeGreaterThanOrEqual(3);
      expect(m.yn.every((v) => v === -1 || v === 0 || v === 1)).toBe(true);
    });
  });
  it('36 карт: по одной на каждую карту колоды, фигуры — с людьми', () => {
    expect(KARTY.cards.map((c) => c.key)).toEqual(KARTY36.map((c) => c.s + c.r));
    for (const c of KARTY36) if (c.r >= 11 && c.r <= 13) expect(KARTY.persons[c.s + c.r], c.s + c.r).toBeTruthy();
    for (const n of KARTY.near) expect(KARTY36.some((c) => c.s + c.r === n.a) && KARTY36.some((c) => c.s + c.r === n.b)).toBe(true);
  });
});

describe('расклады', () => {
  it('у каждого — места, подписи и своё число карт', () => {
    expect(new Set(SPREADS.map((s) => s.id)).size).toBe(SPREADS.length);
    for (const s of SPREADS) {
      expect(s.spots.length, s.id).toBeGreaterThan(0);
      expect(slotsOf(s)).toHaveLength(spreadSize(s));
      for (const p of s.spots) expect(p.label && p.hint, `${s.id}: ${p.label}`).toBeTruthy();
    }
    expect(SPREADS.filter((s) => s.deck === 'taro')).toHaveLength(12);
    expect(spreadSize(spreadById('kelt')!)).toBe(10);
  });
});

describe('тасовка', () => {
  const rng = new SeededRng(7);
  it('таро: вся колода, без повторов, часть карт перевёрнута', () => {
    const d = shuffleDeck('taro', { reversed: true, majors: false }, rng);
    expect(new Set(d.map((x) => x.card)).size).toBe(78);
    expect(d.some((x) => x.rev) && d.some((x) => !x.rev)).toBe(true);
  });
  it('«все карты прямо» и «только старшие»', () => {
    const d = shuffleDeck('taro', { reversed: false, majors: true }, rng);
    expect(d).toHaveLength(22);
    expect(d.every((x) => isMajor(x.card) && !x.rev)).toBe(true);
  });
  it('обычная колода: 36 карт, перевёрнутых нет, карта загаданного не тянется', () => {
    const person = KARTY36.findIndex((c) => c.s === 'H' && c.r === 12);
    const d = shuffleDeck('karty', { reversed: true, majors: false, person }, rng);
    expect(d).toHaveLength(35);
    expect(d.some((x) => x.rev || x.card === person)).toBe(false);
  });
});

describe('итоги', () => {
  const k = (key: string): Drawn => ({ card: KARTY36.findIndex((c) => c.s + c.r === key), rev: false });
  it('«да или нет» — по большинству', () => {
    const s = spreadById('da-net')!;
    const yes = [...Array(78).keys()].filter((c) => TARO[c].yn[0] === 1).slice(0, 3);
    expect(verdictOf(s, yes.map((card) => ({ card, rev: false })))?.word).toBe('да');
    const no = [...Array(78).keys()].filter((c) => TARO[c].yn[0] === -1).slice(0, 3);
    expect(verdictOf(s, no.map((card) => ({ card, rev: false })))?.word).toBe('нет');
    expect(verdictOf(s, [])).toBeNull();
  });
  it('«на желание» — туз или девятка червей', () => {
    const s = spreadById('zhelanie')!;
    expect(verdictOf(s, ['S6', 'C7', 'H9', 'D8', 'S11'].map(k))?.word).toBe('сбудется');
    expect(verdictOf(s, ['S6', 'C7', 'H7', 'H8', 'D11'].map(k))?.word).toBe('сбудется не сразу');
    expect(verdictOf(s, ['S6', 'S7', 'C8', 'D9', 'D11'].map(k))?.word).toBe('не сбудется');
    expect(kartaMeaning(k('H9').card).key).toBe('H9');
  });
});

describe('адреса', () => {
  it('у каждой карты свой адрес, и он открывает ту же карту', () => {
    const seen = new Set<string>();
    const all = [...Array.from({ length: TAROT_SIZE }, (_, c) => ['taro', c] as const), ...KARTY36.map((_, i) => ['karty', i] as const)];
    for (const [deck, c] of all) {
      const p = cardPath(deck, c);
      expect(seen.has(p), p).toBe(false);
      seen.add(p);
      expect(parseGadanie(p)).toEqual({ mode: 'znacheniya', deck, card: c });
    }
    for (const m of MODES) if (m.path) expect(parseGadanie(`/${GADANIE_PATH}/${m.path}/`)?.mode).toBe(m.id);
    expect(parseGadanie(`/${GADANIE_PATH}/`)?.mode).toBe('vybor');
  });
});
