/* Таблицы рекордов: места и разделы, обрезка, перенос старых рекордов аркад, переигрывание партий на сервере. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Authority } from '../src/core/authority';
import { DAY, HELP_SUFFIX, prune, ranked, RECORD_GAMES, verifyReplay, withDefaults, type RecordColumn, type RecordEntry, type Replay } from '../src/core/records';
import { SeededRng } from '../src/core/rng';
import type { GameDef, Options } from '../src/core/types';
import { DEFS } from '../src/games/defs';
import { FileRecordStore, Records } from '../server/records';

const TIME: RecordColumn[] = [{ key: 'ms', label: 'Время', sort: 'asc', format: 'time' }];
const now = Date.UTC(2026, 9, 20);
const row = (name: string, ms: number, ago: number, device = name): RecordEntry => ({ name, values: { ms }, at: now - ago, device });

describe('таблица', () => {
  const list = [row('Вовка', 9000, 1 * DAY), row('Вовка', 7000, 40 * DAY), row('Ленка', 8000, 2 * DAY), row('Пашка', 12000, 10 * DAY), row('Ленка', 11000, 1000)];

  it('за всё время — лучший результат каждого, по возрастанию времени', () => {
    expect(ranked(list, TIME, 'all', undefined, now).map((e) => [e.name, e.values.ms])).toEqual([
      ['Вовка', 7000],
      ['Ленка', 8000],
      ['Пашка', 12000],
    ]);
  });
  it('неделя и месяц — только свежие', () => {
    expect(ranked(list, TIME, 'week', undefined, now).map((e) => e.name)).toEqual(['Ленка', 'Вовка']);
    expect(ranked(list, TIME, 'month', undefined, now).map((e) => e.values.ms)).toEqual([8000, 9000, 12000]);
  });
  it('мои — все свои результаты', () => {
    expect(ranked(list, TIME, 'mine', { device: 'Ленка' }, now).map((e) => e.values.ms)).toEqual([8000, 11000]);
    expect(ranked(list, TIME, 'mine', undefined, now)).toEqual([]);
  });
  it('очки — по убыванию, при равенстве — по второму столбцу, потом кто раньше', () => {
    const cols: RecordColumn[] = [
      { key: 'score', label: 'Очки', sort: 'desc', format: 'score' },
      { key: 'ms', label: 'Время', sort: 'asc', format: 'time' },
    ];
    const l: RecordEntry[] = [
      { name: 'а', values: { score: 10, ms: 5000 }, at: 3, device: 'a' },
      { name: 'б', values: { score: 12, ms: 9000 }, at: 2, device: 'b' },
      { name: 'в', values: { score: 10, ms: 4000 }, at: 1, device: 'c' },
      { name: 'г', values: { score: 10, ms: 4000 }, at: 0, device: 'd' },
    ];
    expect(ranked(l, cols, 'all').map((e) => e.name)).toEqual(['б', 'г', 'в', 'а']);
  });
  it('обрезка оставляет лучших и свои лучшие у каждого', () => {
    const many: RecordEntry[] = [];
    for (let i = 0; i < 300; i++) many.push(row('и' + i, 1000 + i, 60 * DAY, 'd' + (i % 150)));
    const kept = prune(many, TIME, now, 100, 1);
    expect(kept.length).toBe(150); // у каждого из 150 устройств — свой лучший
    expect(kept[0].values.ms).toBe(1000);
  });
});

describe('хранение', () => {
  it('переносит старые рекорды аркад из records.json и пишет новый файл', () => {
    const dir = mkdtempSync(join(tmpdir(), 'recs-'));
    writeFileSync(join(dir, 'records.json'), JSON.stringify({ 'treasures-A': [{ name: 'Вовка', score: 5000, at: 1 }, { name: 'Ленка', score: 7000, at: 2 }], 'gops-story': [{ name: 'Пашка', score: 300, at: 3 }] }));
    const store = new FileRecordStore(dir, () => {});
    expect(store.get('treasures/A').map((e) => e.values.score)).toEqual([5000, 7000]);
    expect(store.get('gops/story')[0].name).toBe('Пашка');
    const recs = new Records(store, {});
    expect(recs.list('treasures', 'A', 'all')!.rows.map((r) => r.name)).toEqual(['Ленка', 'Вовка']);
    store.flush();
    const saved = JSON.parse(readFileSync(join(dir, 'records2.json'), 'utf8'));
    expect(saved.boards['treasures/A']).toHaveLength(2);
    // второй запуск читает новый файл, старый больше не переносит
    expect(new FileRecordStore(dir, () => {}).get('treasures/A')).toHaveLength(2);
  });

  it('аркада: принимает очки, отсекает вздор; html для страницы', async () => {
    const recs = new Records(new FileRecordStore(mkdtempSync(join(tmpdir(), 'recs-')), () => {}), { saper: await DEFS.saper() });
    expect(await recs.add({ game: 'eggs', name: '<b>Вовка</b>', table: 'A', label: 'Сто уровней', values: { score: 120 } })).toMatchObject({ ok: true, place: 1 });
    expect((await recs.add({ game: 'eggs', name: 'x', table: 'A', values: { score: -5 } })).ok).toBe(false);
    expect((await recs.add({ game: 'nosuch', name: 'x', table: 'A', values: { score: 5 } })).ok).toBe(false);
    expect((await recs.add({ game: 'saper', name: 'x', table: 'beginner', values: { ms: 1 } })).ok).toBe(false); // пошаговой игре нужна запись партии
    const html = recs.html('eggs');
    expect(html).toContain('Сто уровней');
    expect(html).not.toContain('<b>Вовка');
  });

  it('вошедший игрок: рекорд под именем аккаунта, «мои» — с любого устройства', async () => {
    const recs = new Records(new FileRecordStore(mkdtempSync(join(tmpdir(), 'recs-')), () => {}), {});
    await recs.add({ game: 'eggs', name: 'Кто-то', device: 'phone-1', table: 'A', values: { score: 50 } }, { id: '7', name: 'Петя' });
    await recs.add({ game: 'eggs', name: 'Гость', device: 'pc-2', table: 'A', values: { score: 70 } });
    const all = recs.list('eggs', 'A', 'all', 'pc-9', 20, '7')!.rows;
    expect(all.map((r) => [r.name, !!r.me])).toEqual([
      ['Гость', false],
      ['Петя', true],
    ]);
    expect(recs.list('eggs', 'A', 'mine', 'pc-9', 20, '7')!.rows.map((r) => r.name)).toEqual(['Петя']);
  });
});

// ------------------------------------------------------------------ переигрывание

/** Доиграть одиночную партию ботом за человека; паузы между ходами — dt мс. */
async function play(def: GameDef, opts: Options, seed: number, level: number, dt = 700, max = 4000) {
  const seats = [{ seat: def.seatsFor ? def.seatsFor(1)[0] : 0, kind: 'human' as const, level: 0, name: 'Я' }];
  const t0 = 1_700_000_000_000;
  const a = new Authority(def, seats, opts, undefined, { seed, t0 });
  const rng = new SeededRng(seed ^ 0x9e3779b9);
  for (let i = 0; i < max && !a.result; i++) {
    const seat = a.toAct()[0];
    const act = await def.bot.choose(a.viewFor([seat]), seat, level, rng);
    if (act == null || !a.act(seat, act, dt)) break;
  }
  const replay: Replay = JSON.parse(JSON.stringify({ seed, t0, options: opts, seats, log: a.log }));
  return { a, replay };
}

// все описания игр (загружаются лениво): у кого есть рекорды
const ALL: Record<string, GameDef> = {};
const loaded = Promise.all(Object.entries(DEFS).map(async ([id, load]) => (ALL[id] = await load())));

describe('переигрывание на сервере', () => {
  it('список игр с рекордами (сервер грузит их при старте) совпадает с def.records', async () => {
    await loaded;
    expect(Object.values(ALL).filter((d) => d.records).map((d) => d.id).sort()).toEqual(RECORD_GAMES.slice().sort());
  }, 60_000);

  for (const id of RECORD_GAMES) {
    it(`${id}: итог сервера совпадает с итогом игрока, подделка не проходит`, async () => {
      const def = await DEFS[id]();
      const rec = def.records!;
      expect(rec.tables().length).toBeGreaterThan(0);
      let verified = 0;
      const presets = [{ options: {} }, ...(def.presets ?? [])];
      for (const [k, p] of presets.entries()) {
        const opts = withDefaults(def, p.options);
        const t = rec.table(opts);
        if (!t) continue;
        expect(t.id).toMatch(/^[\w.:,=+-]{1,60}$/);
        const { a, replay } = await play(def, opts, 1000 + k, def.bot.levels.length - 1);
        if (!a.result) continue;
        const local = rec.score(a.state, { ms: a.playMs, actions: a.log!.map((x) => x[1]), opts });
        const v = verifyReplay(def, replay);
        if (!local) {
          expect(v).toBeNull();
          continue;
        }
        expect(v).not.toBeNull();
        expect(v!.values).toEqual(local.values);
        expect(v!.table).toBe(t.id + (local.help ? HELP_SUFFIX : ''));
        verified++;
        // недоигранная партия
        expect(verifyReplay(def, { ...replay, log: replay.log.slice(0, -1) })).toBeNull();
        // слишком быстро
        expect(verifyReplay(def, { ...replay, log: replay.log.map((x) => [x[0], x[1], 0] as typeof x) })).toBeNull();
        // соперник за столом — не рекорд
        expect(verifyReplay(def, { ...replay, seats: [...replay.seats, { seat: 1, kind: 'bot', level: 0, name: 'б' }] })).toBeNull();
      }
      expect(verified, `${def.id}: ни одной партии бот не доиграл до рекорда`).toBeGreaterThan(0);
    }, 120_000);
  }
});
