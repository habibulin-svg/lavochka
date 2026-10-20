// Тексты из админки без сети: записи поверх файловых, переименование, «Слово Мастера», картинки, выгрузка для пререндера.
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { Content, readFilePosts } from '../server/content';

const ROOT = resolve(__dirname, '..');
let ipN = 0;

async function setup() {
  const acc = new Accounts(new MemoryAccountStore(), new MemoryMailer());
  const data = mkdtempSync(join(process.env.TEMP || tmpdir(), 'lav-content-'));
  let builds = 0;
  const c = new Content(acc, ROOT, data, async () => (builds++, 'ok'));
  const ctx = (sid?: string) => ({ sid, ip: '10.4.0.' + ++ipN, ua: 'test', site: '' });
  const reg = async (email: string, master: boolean) => {
    const r = await acc.register({ email, password: 'пароль-игрока', consent: true, name: master ? 'Мастер' : 'Вася' }, ctx());
    if (master) await acc.store.grant((r.body.user as any).id, 'master', null, null);
    return r.sid as string;
  };
  return { acc, c, data, ctx, boss: await reg('boss@x.ru', true), vasya: await reg('vasya@x.ru', false), builds: () => builds };
}
const q = (s = '') => new URLSearchParams(s);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('тексты из админки', () => {
  it('файловые записи читаются; правка в базе заменяет файл, снять и вернуть', async () => {
    const { c, ctx, boss, vasya, data, builds } = await setup();
    const files = readFilePosts(ROOT);
    expect(files.length).toBeGreaterThan(0);
    const f = files.find((p) => p.kind === 'blog')!;
    expect((await c.list(q(), ctx(vasya))).code).toBe(403);
    let r = await c.list(q(`kind=blog&slug=${f.slug}`), ctx(boss));
    expect((r.body as any).post).toMatchObject({ source: 'file', title: f.title });
    expect((r.body as any).post.body).toContain('##');
    expect((await c.save({ kind: 'blog', slug: f.slug, title: 'Правка', description: 'о', date: '2026-10-20', body: '## Раз\n\n[[игра:durak]]' }, ctx(boss))).code).toBe(200);
    r = await c.list(q(), ctx(boss));
    expect((r.body as any).posts.find((p: any) => p.slug === f.slug)).toMatchObject({ source: 'both', title: 'Правка' });
    await wait(1700);
    expect(builds()).toBe(1);
    const out = JSON.parse(readFileSync(join(data, 'posts.json'), 'utf8'));
    expect(out).toEqual([expect.objectContaining({ kind: 'blog', slug: f.slug, title: 'Правка' })]);
    // убрать правку — запись снова из файла
    await c.save({ kind: 'blog', slug: f.slug, remove: true }, ctx(boss));
    r = await c.list(q(`kind=blog&slug=${f.slug}`), ctx(boss));
    expect((r.body as any).post.source).toBe('file');
  });

  it('новая запись, проверки, переименование файловой снимает старый адрес', async () => {
    const { c, acc, ctx, boss } = await setup();
    expect((await c.save({ kind: 'news', slug: 'Плохой адрес', title: 'А', description: 'б', body: '' }, ctx(boss))).code).toBe(400);
    expect((await c.save({ kind: 'news', slug: 'novaya', title: '', description: 'б', body: '' }, ctx(boss))).code).toBe(400);
    expect((await c.save({ kind: 'news', slug: 'novaya', title: 'А', description: '', body: '' }, ctx(boss))).code).toBe(400);
    expect((await c.save({ kind: 'news', slug: 'novaya', title: 'Новая', description: 'о', body: 'текст', games: 'durak, <x>, nardy' }, ctx(boss))).code).toBe(200);
    const p = (await acc.store.posts()).find((x) => x.slug === 'novaya')!;
    expect(p.games).toEqual(['durak', 'nardy']);
    expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const f = readFilePosts(ROOT).find((x) => x.kind === 'news')!;
    await c.save({ kind: 'news', slug: 'pereimenovana', oldSlug: f.slug, title: f.title, description: f.description, date: f.date, body: f.body }, ctx(boss));
    const all = await acc.store.posts();
    expect(all.find((x) => x.slug === f.slug)?.hidden).toBe(true);
    expect(all.find((x) => x.slug === 'pereimenovana')?.hidden).toBe(false);
  });

  it('«Слово Мастера»: всем читать, писать — Мастеру', async () => {
    const { c, ctx, boss, vasya } = await setup();
    expect((await c.masterWord()).body.body).toBeNull();
    expect((await c.save({ kind: 'master', title: 'Слово Мастера', body: 'Мир дому твоему!' }, ctx(vasya))).code).toBe(403);
    expect((await c.save({ kind: 'master', title: 'Слово Мастера', body: 'Мир дому твоему!\n\n[[игра:durak]]' }, ctx(boss))).code).toBe(200);
    expect((await c.masterWord()).body).toMatchObject({ title: 'Слово Мастера', body: 'Мир дому твоему!\n\n[[игра:durak]]' });
  });

  it('картинки: только изображения, имя по содержимому', async () => {
    const { c, ctx, boss, vasya, data } = await setup();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect((await c.upload(png, ctx(vasya))).code).toBe(403);
    expect((await c.upload(Buffer.from('<svg onload=alert(1)>'), ctx(boss))).code).toBe(400);
    const r = await c.upload(png, ctx(boss));
    expect(r.body.url).toMatch(/^\/uploads\/[0-9a-f]{16}\.png$/);
    expect(existsSync(join(data, r.body.url as string))).toBe(true);
    expect((await c.upload(png, ctx(boss))).body.url).toBe(r.body.url);
  });
});
