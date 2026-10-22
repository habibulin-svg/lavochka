// Личный маршрут от Михалыча: профиль ученика, кандидаты из базы, разбор ошибок в своих партиях, сервер оставляет
// только шаги из списка кандидатов.
import { describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { Mihalych } from '../server/mihalych';
import { classify, isMistake, reviewGame, type MyGame } from '../src/games/kruzhok/mygames';
import { buildProfile, profileText, routeItems, type RouteInput } from '../src/games/kruzhok/route';

const input = (over: Partial<RouteInput> = {}): RouteInput => {
  const solved: Record<string, 0 | 1> = {};
  const themesOf = new Map<string, string[]>();
  // вилки: 6 из 8 с ошибкой; связки: 1 из 8
  for (let i = 0; i < 8; i++) {
    solved['f' + i] = i < 6 ? 0 : 1;
    themesOf.set('f' + i, ['fork']);
    solved['p' + i] = i < 1 ? 0 : 1;
    themesOf.set('p' + i, ['pin']);
  }
  return {
    rating: 1100,
    solved,
    themesOf,
    lessons: [
      { id: 'vilka', title: 'Вилка', part: 'Тактика', n: 24 },
      { id: 'svyazka', title: 'Связка', part: 'Тактика', n: 25 },
      { id: 'doska', title: 'Доска', part: 'Доска и фигуры', n: 1 },
    ],
    lessonsDone: { doska: 1 },
    games: [],
    etudes: [{ id: 'reti-1921', title: 'Король догоняет пешку', author: 'Рети', level: 1 }],
    etudesDone: {},
    classics: [{ id: 'immortal', title: 'Бессмертная', white: 'Андерсен', black: 'Кизерицкий', year: 1851 }],
    classicsSeen: {},
    ...over,
  };
};

describe('личный маршрут: профиль и кандидаты', () => {
  it('слабая тема — вилка: урок и подборка задач, следующий урок, этюд и партия', () => {
    const x = input();
    const p = buildProfile(x);
    expect(p.weak).toEqual(['fork']);
    expect(p.nextLesson?.id).toBe('vilka');
    const ids = routeItems(x, p).map((i) => i.id);
    expect(ids.slice(0, 2)).toEqual(['lesson:vilka', 'drill:fork']);
    expect(ids).toContain('etude:reti-1921');
    expect(ids).toContain('game:immortal');
    expect(profileText(p, 1100)).toContain('Слабые темы: Вилка');
  });

  it('ошибки в своих партиях: зевки → задачи на незащищённые фигуры, своя позиция на повтор', () => {
    const g: MyGame = {
      at: 1,
      side: 0,
      result: 0,
      moves: [],
      review: { mine: 30, mistakes: [{ ply: 14, kind: 'hang', phase: 'middle', loss: 500 }, { ply: 22, kind: 'hang', phase: 'middle', loss: 300 }] },
    };
    const x = input({ games: [g], solved: {}, themesOf: new Map() });
    const p = buildProfile(x);
    expect(p.mistakes).toEqual({ hang: 2 });
    const ids = routeItems(x, p).map((i) => i.id);
    expect(ids).toContain('drill:hangingPiece');
    expect(ids).toContain('mine:1:14');
    expect(profileText(p, 1100)).toContain('зевок фигуры');
  });

  it('тип ошибки и порог', () => {
    expect(isMistake(50, -150)).toBe(true);
    expect(isMistake(50, -50)).toBe(false);
    expect(isMistake(900, 400)).toBe(false); // перевес остался решающим
    expect(classify({ before: 9990, after: 300, bestTakes: false, replyTakes: false, phase: 'middle' })).toBe('mate');
    expect(classify({ before: 0, after: -300, bestTakes: false, replyTakes: true, phase: 'middle' })).toBe('hang');
    expect(classify({ before: 300, after: 0, bestTakes: true, replyTakes: false, phase: 'middle' })).toBe('tactic');
    expect(classify({ before: 0, after: -200, bestTakes: false, replyTakes: false, phase: 'end' })).toBe('endgame');
  });

  it('разбор партии: ход ученика, после которого оценка рухнула, — ошибка', async () => {
    // 1. f3 e5 2. g4?? Фh4# — второй ход белых проигрывает
    const g: MyGame = { at: 1, side: 0, result: 0, moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'] };
    const sf = {
      analyse: async (fen: string) => {
        // после 2. g4 у чёрных мат в 1, в остальных позициях — равно
        if (fen.startsWith('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b')) return { best: 'd8h4', lines: [{ cp: 0, mate: 1 }] };
        return { best: null, lines: [{ cp: 0, mate: null }] };
      },
    };
    const r = await reviewGame(g, sf);
    expect(r?.mine).toBe(2);
    expect(r?.mistakes).toEqual([expect.objectContaining({ ply: 2, kind: 'mate' })]);
  });
});

describe('маршрут на сервере', () => {
  it('шаги — только из списка кандидатов, без повторов; без подписки — отказ', async () => {
    const acc = new Accounts(new MemoryAccountStore(), new MemoryMailer());
    const reply = { intro: 'Вилки видишь через раз.', steps: [{ id: 'lesson:vilka', say: 'Начни с урока.' }, { id: 'lesson:vydumka', say: 'нет такого' }, { id: '[drill:fork]', say: 'Порешай.' }, { id: 'lesson:vilka', say: 'повтор' }] };
    const http = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'Вот: ' + JSON.stringify(reply) } }], usage: { prompt_tokens: 900, completion_tokens: 200, cost: 0.05 } }) });
    const m = new Mihalych(acc, { key: 'k' }, () => {}, http);
    const r0 = await acc.register({ email: 'a@x.ru', password: 'пароль-ученика', consent: true, name: 'Ученик' }, { ip: '10.9.0.1', ua: 't', site: 'https://lavochka-games.ru' });
    const ctx = { sid: r0.sid as string, ip: '10.9.0.2', ua: 't', site: 'https://lavochka-games.ru' };
    const items = [
      { id: 'lesson:vilka', title: 'Урок 24. Вилка', why: 'вилка 6/8' },
      { id: 'drill:fork', title: 'Задачи: Вилка', why: 'вилка 6/8' },
    ];
    expect((await m.route({ profile: 'x', items }, ctx)).code).toBe(403);
    await acc.store.grant((r0.body.user as any).id, 'ai', null, null);
    const r = await m.route({ profile: 'Рейтинг 1100', items }, ctx);
    expect(r.code).toBe(200);
    expect(r.body.intro).toBe('Вилки видишь через раз.');
    expect(r.body.steps).toEqual([
      { id: 'lesson:vilka', say: 'Начни с урока.' },
      { id: 'drill:fork', say: 'Порешай.' },
    ]);
  });
});
