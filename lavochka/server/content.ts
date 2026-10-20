/* Тексты сайта из админки: новости, блог, «Слово Мастера», картинки к ним. Записи — в базе (таблица posts); новости и блог
 * после каждой правки выгружаются в DATA_DIR/posts.json, и сервер сам перезапускает пререндер (tools/prerender.ts, ~4 с) —
 * страницы остаются статичными, как и файловые (content/news, content/blog): тот же адрес в базе заменяет файл, hidden — снимает.
 *   GET  /api/master-word                       — «Слово Мастера» (Markdown) всем; нет записи — сайт покажет встроенное письмо
 *   GET  /api/admin/posts[?kind=&slug=]         — Мастеру: список записей / одна с текстом
 *   POST /api/admin/posts {kind, slug, …, oldSlug?} — сохранить (переименование файловой записи снимает старый адрес)
 *   POST /api/admin/posts {kind, slug, remove: true} — убрать правку из базы (файловая запись вернётся как была)
 *   POST /api/admin/upload (тело — картинка)    — Мастеру: картинка в DATA_DIR/uploads → {url: '/uploads/<имя>'} */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Accounts, Ctx, Reply } from './accounts/accounts';
import { cookieOf, sameOrigin, send, siteOf } from './accounts/http';
import type { PostRow, User } from './accounts/store';

const err = (code: number, error: string, message: string): Reply => ({ code, body: { error, message } });
export const POST_KINDS = { news: 'content/news', blog: 'content/blog' } as const;
const KINDS = ['news', 'blog', 'master'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;
/** Картинки: тип по первым байтам → расширение. */
const IMAGE_SIG: [string, number[]][] = [
  ['webp', [0x52, 0x49, 0x46, 0x46]],
  ['png', [0x89, 0x50, 0x4e, 0x47]],
  ['jpg', [0xff, 0xd8, 0xff]],
  ['gif', [0x47, 0x49, 0x46, 0x38]],
];
export const UPLOAD_MAX = 5 * 1024 * 1024;

const line = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export interface FilePost {
  kind: 'news' | 'blog';
  slug: string;
  title: string;
  h1: string | null;
  description: string;
  date: string;
  image: string | null;
  games: string[];
  body: string;
}

/** Файловые записи (content/news, content/blog) — шапка и текст как есть, без разметки. */
export function readFilePosts(root: string): FilePost[] {
  const out: FilePost[] = [];
  for (const [kind, dir] of Object.entries(POST_KINDS) as ['news' | 'blog', string][]) {
    const d = join(root, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const m = readFileSync(join(d, f), 'utf8')
        .replace(/^﻿/, '')
        .match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (!m) continue;
      const meta: Record<string, string> = {};
      for (const l of m[1].split(/\r?\n/)) {
        const kv = l.match(/^(\w+):\s*(.*)$/);
        if (kv) meta[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, '$1');
      }
      out.push({
        kind,
        slug: f.slice(0, -3),
        title: meta.title ?? '',
        h1: meta.h1 || null,
        description: meta.description ?? '',
        date: meta.date ?? '',
        image: meta.image || null,
        games: (meta.games || '').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean),
        body: m[2].replace(/\r/g, '').replace(/^\n+/, ''),
      });
    }
  }
  return out;
}

export interface RebuildState {
  running: boolean;
  at: number | null;
  ok: boolean | null;
  message: string;
}

export class Content {
  rebuild: RebuildState = { running: false, at: null, ok: null, message: '' };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private again = false;

  constructor(
    private acc: Accounts,
    private root: string,
    private data: string,
    /** Пересобрать страницы (по умолчанию — пререндер дочерним процессом); null — не пересобирать (тесты). */
    private runPrerender: (() => Promise<string>) | null = null,
    private log: (s: string) => void = () => {}
  ) {}

  private async master(ctx: Ctx): Promise<User | null> {
    const u = await this.acc.current(ctx);
    if (!u) return null;
    const rights = await this.acc.store.rights(u.id, ctx.now ?? Date.now());
    return rights.some((r) => r.right === 'master') ? u : null;
  }

  async masterWord(): Promise<Reply> {
    const p = (await this.acc.store.posts()).find((x) => x.kind === 'master' && !x.hidden);
    return { code: 200, body: p ? { title: p.title, body: p.body, updatedAt: p.updatedAt } : { body: null } };
  }

  async list(q: URLSearchParams, ctx: Ctx): Promise<Reply> {
    if (!(await this.master(ctx))) return err(403, 'master', 'Только для Мастера.');
    const db = await this.acc.store.posts();
    const files = readFilePosts(this.root);
    const kind = q.get('kind');
    const slug = q.get('slug');
    if (kind && slug) {
      const d = db.find((p) => p.kind === kind && p.slug === slug);
      const f = files.find((p) => p.kind === kind && p.slug === slug);
      if (!d && !f) return err(404, 'post', 'Нет такой записи.');
      return { code: 200, body: { post: { ...(f ?? {}), ...(d ?? {}), hidden: d?.hidden ?? false, source: d && f ? 'both' : d ? 'db' : 'file' } } };
    }
    const all = new Map<string, any>();
    for (const f of files) all.set(f.kind + '/' + f.slug, { kind: f.kind, slug: f.slug, title: f.title, date: f.date, hidden: false, source: 'file', updatedAt: null });
    for (const d of db) {
      const k = d.kind + '/' + d.slug;
      all.set(k, { kind: d.kind, slug: d.slug, title: d.title, date: d.date, hidden: d.hidden, source: all.has(k) ? 'both' : 'db', updatedAt: d.updatedAt });
    }
    const posts = [...all.values()].sort((a, b) => b.date.localeCompare(a.date));
    return { code: 200, body: { posts, rebuild: this.rebuild } };
  }

  async save(b: any, ctx: Ctx): Promise<Reply> {
    const me = await this.master(ctx);
    if (!me) return err(403, 'master', 'Только для Мастера.');
    const now = ctx.now ?? Date.now();
    const kind = String(b?.kind ?? '');
    if (!KINDS.includes(kind)) return err(400, 'kind', 'Нет такого раздела.');
    const slug = kind === 'master' ? 'slovo' : String(b?.slug ?? '').trim();
    if (!SLUG_RE.test(slug)) return err(400, 'slug', 'Адрес — латиница, цифры и дефисы (от 2 до 80).');
    const st = this.acc.store;
    if (b?.remove) {
      await st.deletePost(kind, slug);
      this.log(`тексты: ${me.name} убрал правку ${kind}/${slug}`);
      if (kind !== 'master') this.schedule();
      return { code: 200, body: { ok: true } };
    }
    const title = line(b?.title, 200);
    const body = String(b?.body ?? '').replace(/\r\n?/g, '\n').slice(0, 100_000);
    if (!title) return err(400, 'title', 'Нужен заголовок.');
    if (kind !== 'master' && !line(b?.description, 300)) return err(400, 'description', 'Нужно описание (для поисковиков и списка записей).');
    const day = String(b?.date ?? '');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
    const image = line(b?.image, 300);
    const p: PostRow = {
      kind,
      slug,
      title,
      h1: line(b?.h1, 200) || null,
      description: line(b?.description, 300),
      date,
      image: image && /^\/[\w./-]+$/.test(image) ? image : null,
      games: (Array.isArray(b?.games) ? b.games : String(b?.games ?? '').split(','))
        .map((s: unknown) => String(s).trim())
        .filter((s: string) => /^[\w-]{1,40}$/.test(s))
        .slice(0, 20),
      body,
      hidden: !!b?.hidden,
      updatedAt: now,
      updatedBy: me.id,
    };
    // переименование: старый адрес убрать (у файловой записи — снять, иначе на сайте окажутся две)
    const old = String(b?.oldSlug ?? '');
    if (kind !== 'master' && old && old !== slug && SLUG_RE.test(old)) {
      const fileHas = readFilePosts(this.root).some((f) => f.kind === kind && f.slug === old);
      if (fileHas) await st.savePost({ ...p, slug: old, hidden: true });
      else await st.deletePost(kind, old);
    }
    await st.savePost(p);
    this.log(`тексты: ${me.name} сохранил ${kind}/${slug}${p.hidden ? ' (снята)' : ''}`);
    if (kind !== 'master') this.schedule();
    return { code: 200, body: { ok: true, slug } };
  }

  /** Картинка к записи. */
  async upload(buf: Buffer, ctx: Ctx): Promise<Reply> {
    if (!(await this.master(ctx))) return err(403, 'master', 'Только для Мастера.');
    const ext = IMAGE_SIG.find(([, sig]) => sig.every((x, i) => buf[i] === x))?.[0];
    if (!ext || (ext === 'webp' && buf.subarray(8, 12).toString('latin1') !== 'WEBP')) return err(400, 'type', 'Нужна картинка: webp, png, jpg или gif.');
    const name = createHash('sha1').update(buf).digest('hex').slice(0, 16) + '.' + ext;
    const dir = join(this.data, 'uploads');
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, name))) writeFileSync(join(dir, name), buf);
    return { code: 200, body: { url: '/uploads/' + name } };
  }

  /** Выгрузить новости и блог из базы для пререндера. */
  async exportPosts() {
    const list = (await this.acc.store.posts())
      .filter((p) => p.kind === 'news' || p.kind === 'blog')
      .map((p) => ({ kind: p.kind, slug: p.slug, title: p.title, h1: p.h1 ?? undefined, description: p.description, date: p.date, image: p.image ?? undefined, games: p.games, body: p.body, hidden: p.hidden || undefined }));
    mkdirSync(this.data, { recursive: true });
    writeFileSync(join(this.data, 'posts.json'), JSON.stringify(list));
    return list.length;
  }

  /** Пересобрать страницы через пару секунд (несколько правок подряд — одной сборкой). */
  schedule(delay = 1500) {
    if (!this.runPrerender) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  private async run() {
    if (this.rebuild.running) {
      this.again = true;
      return;
    }
    this.rebuild = { ...this.rebuild, running: true };
    try {
      await this.exportPosts();
      const msg = await this.runPrerender!();
      this.rebuild = { running: false, at: Date.now(), ok: true, message: msg };
      this.log('тексты: страницы пересобраны — ' + msg);
    } catch (e) {
      this.rebuild = { running: false, at: Date.now(), ok: false, message: (e as Error).message.slice(0, 500) };
      this.log('тексты: пересборка не удалась — ' + (e as Error).message);
    }
    if (this.again) {
      this.again = false;
      this.schedule(100);
    }
  }
}

/** Пререндер дочерним процессом (tsx из node_modules); на проде затем IndexNow — сообщить поисковикам новые страницы. */
export function prerenderProcess(root: string, data: string, prod: boolean): () => Promise<string> {
  const run = (args: string[]) =>
    new Promise<string>((ok, bad) => {
      const p = spawn(process.execPath, args, { cwd: root, env: { ...process.env, DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      const t = setTimeout(() => p.kill(), 120_000);
      p.on('close', (code) => {
        clearTimeout(t);
        const last = out.trim().split('\n').pop() ?? '';
        code === 0 ? ok(last) : bad(new Error(`код ${code}: ${out.trim().slice(-400)}`));
      });
      p.on('error', bad);
    });
  return async () => {
    const msg = await run([join(root, 'node_modules/tsx/dist/cli.mjs'), 'tools/prerender.ts']);
    if (prod) await run(['tools/indexnow.mjs', data]).catch(() => '');
    return msg;
  };
}

export async function contentApi(
  c: Content,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ip: string,
  readBody: (req: IncomingMessage, limit?: number) => Promise<string>,
  readRaw: (req: IncomingMessage, limit: number) => Promise<Buffer>
): Promise<boolean> {
  const path = url.pathname;
  if (path !== '/api/master-word' && path !== '/api/admin/posts' && path !== '/api/admin/upload') return false;
  const ctx: Ctx = { sid: cookieOf(req), ip, ua: String(req.headers['user-agent'] || ''), site: siteOf(req) };
  if (req.method === 'GET') {
    send(req, res, path === '/api/master-word' ? await c.masterWord() : path === '/api/admin/posts' ? await c.list(url.searchParams, ctx) : { code: 405, body: { error: 'method' } });
    return true;
  }
  if (req.method !== 'POST' || path === '/api/master-word') {
    send(req, res, { code: 405, body: { error: 'method' } });
    return true;
  }
  if (!sameOrigin(req)) {
    send(req, res, { code: 403, body: { error: 'origin' } });
    return true;
  }
  if (path === '/api/admin/upload') {
    let buf: Buffer;
    try {
      buf = await readRaw(req, UPLOAD_MAX);
    } catch {
      send(req, res, { code: 413, body: { error: 'big', message: 'Картинка больше 5 МБ — уменьшите.' } });
      return true;
    }
    send(req, res, await c.upload(buf, ctx));
    return true;
  }
  if (!/^application\/json/.test(String(req.headers['content-type'] || ''))) {
    send(req, res, { code: 403, body: { error: 'origin' } });
    return true;
  }
  let b: any;
  try {
    b = JSON.parse((await readBody(req, 200_000)) || '{}');
  } catch {
    send(req, res, { code: 400, body: { error: 'bad body' } });
    return true;
  }
  send(req, res, await c.save(b, ctx));
  return true;
}
