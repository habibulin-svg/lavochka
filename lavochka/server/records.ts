/* Таблицы рекордов на сервере: хранение (слой RecordStore — сейчас файл в DATA_DIR, на этапе 3 его заменит Postgres),
 * приём результата (пошаговые игры — переигрывание записи партии движком def, аркады — правдоподобие) и выдача таблиц.
 *
 *   GET  /api/records?game=saper&table=beginner&period=all|month|week|mine&device=…  → { rows, columns, tables }
 *   POST /api/records { game, name, device, replay | table+values }                 → { ok, table, values, place, placeWeek }
 *   старое: GET/POST /api/records/<аркада>-<режим> — для вкладок, открытых до обновления. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARCADE_RECORDS,
  boardKey,
  columnsFor,
  fmtValue,
  GAME_RE,
  HELP_SUFFIX,
  placeOf,
  prune,
  ranked,
  TABLE_RE,
  verifyReplay,
  type Claim,
  type RecordColumn,
  type RecordEntry,
  type RecordPeriod,
} from '../src/core/records';
import type { GameDef } from '../src/core/types';

// ------------------------------------------------------------------ хранение

export interface RecordStore {
  get(board: string): RecordEntry[];
  put(board: string, list: RecordEntry[], label?: string): void;
  label(board: string): string | undefined;
  boards(): string[];
}

interface FileData {
  v: 2;
  boards: Record<string, RecordEntry[]>;
  labels: Record<string, string>;
}

/** Файл records2.json: { v, boards: { "игра/таблица": [строки] }, labels: { "игра/таблица": подпись } }.
 * Пишем не чаще раза в секунду, через временный файл. */
export class FileRecordStore implements RecordStore {
  private data: FileData = { v: 2, boards: {}, labels: {} };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private file: string;

  constructor(
    private dir: string,
    private log: (s: string) => void = console.log
  ) {
    this.file = join(dir, 'records2.json');
    if (existsSync(this.file)) {
      try {
        const d = JSON.parse(readFileSync(this.file, 'utf8'));
        this.data = { v: 2, boards: d.boards ?? {}, labels: d.labels ?? {} };
      } catch (e) {
        // испорченный файл не затираем — откладываем в сторону и начинаем заново
        this.log('рекорды: records2.json не читается, отложен в records2.bad.json: ' + e);
        try {
          renameSync(this.file, join(dir, 'records2.bad.json'));
        } catch {
          /* ignore */
        }
      }
    } else this.migrate();
  }

  /** Первый запуск: перенести старые рекорды аркад (records.json: { "<аркада>-<режим>": [{name, score, at}] }). */
  private migrate() {
    const old = join(this.dir, 'records.json');
    if (!existsSync(old)) return;
    try {
      const raw = JSON.parse(readFileSync(old, 'utf8')) as Record<string, { name: string; score: number; at: number }[]>;
      let n = 0;
      for (const [key, list] of Object.entries(raw)) {
        const i = key.indexOf('-');
        const game = i > 0 ? key.slice(0, i) : key;
        const table = i > 0 ? key.slice(i + 1) : 'A';
        if (!GAME_RE.test(game) || !TABLE_RE.test(table) || !Array.isArray(list)) continue;
        const rows: RecordEntry[] = list
          .filter((r) => r && Number.isFinite(r.score))
          .map((r) => ({ name: String(r.name || 'Аноним').slice(0, 16), values: { score: Math.floor(r.score) }, at: Number(r.at) || 0 }));
        const b = boardKey(game, table);
        this.data.boards[b] = [...(this.data.boards[b] ?? []), ...rows];
        n += rows.length;
      }
      this.flush();
      this.log(`рекорды: перенесено из records.json строк — ${n}`);
    } catch (e) {
      this.log('рекорды: не удалось прочитать records.json: ' + e);
    }
  }

  get(board: string) {
    return this.data.boards[board] ?? [];
  }
  put(board: string, list: RecordEntry[], label?: string) {
    this.data.boards[board] = list;
    if (label) this.data.labels[board] = label;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1000);
  }
  label(board: string) {
    return this.data.labels[board];
  }
  boards() {
    return Object.keys(this.data.boards);
  }
  flush() {
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.file + '.tmp', JSON.stringify(this.data));
      renameSync(this.file + '.tmp', this.file);
    } catch (e) {
      this.log('не удалось сохранить рекорды: ' + e);
    }
  }
}

// ------------------------------------------------------------------ правила приёма

/** Лимит частоты: с одного адреса — не больше 30 рекордов за 10 минут. */
const hits = new Map<string, number[]>();
export function mayPost(ip: string, now = Date.now()): boolean {
  const list = (hits.get(ip) ?? []).filter((t) => t > now - 10 * 60_000);
  if (list.length >= 30) return false;
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 50_000) hits.clear();
  return true;
}

const cleanName = (s: unknown) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 16) || 'Аноним';
const cleanId = (s: unknown) => (typeof s === 'string' && /^[\w-]{6,64}$/.test(s) ? s : undefined);

export interface Accepted {
  board: string;
  table: string;
  label?: string;
  entry: RecordEntry;
  columns: RecordColumn[];
}

/** Проверить присланный результат. Строка — почему не приняли. */
export function accept(claim: Claim, defs: Record<string, GameDef>, now = Date.now()): Accepted | string {
  const game = String(claim?.game ?? '');
  if (!GAME_RE.test(game)) return 'game';
  const columns = columnsFor(game, defs);
  if (!columns) return 'game';
  const base = { name: cleanName(claim.name), at: now, device: cleanId(claim.device) };
  if (ARCADE_RECORDS.includes(game)) {
    const table = String(claim.table ?? '');
    const score = Math.floor(Number(claim.values?.score));
    if (!TABLE_RE.test(table) || table.endsWith(HELP_SUFFIX)) return 'table';
    if (!Number.isFinite(score) || score <= 0 || score > 1e8) return 'score';
    const label = typeof claim.label === 'string' ? cleanName(claim.label).slice(0, 40) : undefined;
    return { board: boardKey(game, table), table, label, columns, entry: { ...base, values: { score } } };
  }
  const v = claim.replay ? verifyReplay(defs[game], claim.replay) : null;
  if (!v) return 'replay';
  const values: Record<string, number> = {};
  for (const c of columns) {
    const x = v.values[c.key];
    if (x != null && Number.isFinite(x)) values[c.key] = Math.round(x);
  }
  return { board: boardKey(game, v.table), table: v.table, label: v.label, columns, entry: { ...base, values, verified: true } };
}

// ------------------------------------------------------------------ выдача

export function publicRows(list: RecordEntry[], me?: string, player?: string) {
  return list.map((e) => ({ name: e.name, values: e.values, at: e.at, ...((me && e.device === me) || (player && e.player === player) ? { me: true } : {}) }));
}

export class Records {
  /** defs — загруженные описания игр с рекордами (могут догружаться: ready — когда все на месте). */
  constructor(
    public store: RecordStore,
    private defs: Record<string, GameDef>,
    private ready: Promise<unknown> = Promise.resolve()
  ) {}

  /** Таблицы игры, где уже есть строки (по порядку из def, затем остальные). */
  tablesOf(game: string): { id: string; label: string; n: number }[] {
    const known = this.defs[game]?.records?.tables() ?? [];
    const have = this.store.boards().filter((b) => b.startsWith(game + '/') && this.store.get(b).length);
    const ids = have.map((b) => b.slice(game.length + 1));
    const label = (id: string) => {
      const plain = id.endsWith(HELP_SUFFIX) ? id.slice(0, -HELP_SUFFIX.length) : id;
      const t = this.store.label(boardKey(game, id)) ?? known.find((k) => k.id === plain)?.label ?? plain;
      return t + (id.endsWith(HELP_SUFFIX) ? ', с подсказками' : '');
    };
    const order = (id: string) => {
      const plain = id.endsWith(HELP_SUFFIX) ? id.slice(0, -HELP_SUFFIX.length) : id;
      const i = known.findIndex((k) => k.id === plain);
      return (i < 0 ? 999 : i) * 2 + (id.endsWith(HELP_SUFFIX) ? 1 : 0);
    };
    return ids.sort((a, b) => order(a) - order(b) || a.localeCompare(b)).map((id) => ({ id, label: label(id), n: this.store.get(boardKey(game, id)).length }));
  }

  /** player — вошедший игрок (номер аккаунта): его строки — «мои» на любом устройстве. */
  list(game: string, table: string, period: RecordPeriod, device?: string, limit = 20, player?: string) {
    const columns = columnsFor(game, this.defs);
    if (!columns || !TABLE_RE.test(table)) return null;
    const rows = ranked(this.store.get(boardKey(game, table)), columns, period, { device, player }, Date.now(), limit);
    return { columns, rows: publicRows(rows, device, player) };
  }

  /** who — вошедший игрок: рекорд записывается на него и под его именем. */
  async add(claim: Claim, who?: { id: string; name: string }) {
    await this.ready;
    const r = accept(claim, this.defs);
    if (typeof r === 'string') return { ok: false as const, error: r };
    if (who) Object.assign(r.entry, { player: who.id, name: who.name });
    const list = prune([...this.store.get(r.board), r.entry], r.columns);
    this.store.put(r.board, list, r.label);
    return {
      ok: true as const,
      table: r.table,
      values: r.entry.values,
      place: placeOf(list, r.columns, r.entry, 'all'),
      placeWeek: placeOf(list, r.columns, r.entry, 'week'),
    };
  }

  /** Лучшие результаты игрока-аккаунта во всех таблицах: игра, таблица, значения, место за всё время (0 — вне таблицы). */
  async ofPlayer(player: string) {
    await this.ready;
    const out: { game: string; table: string; label: string; columns: RecordColumn[]; values: Record<string, number>; at: number; place: number }[] = [];
    for (const b of this.store.boards()) {
      const i = b.indexOf('/');
      const game = b.slice(0, i);
      const table = b.slice(i + 1);
      const columns = columnsFor(game, this.defs);
      if (!columns) continue;
      const list = this.store.get(b);
      const best = ranked(list, columns, 'mine', { player }, Date.now(), 1)[0];
      if (!best) continue;
      const label = this.tablesOf(game).find((t) => t.id === table)?.label ?? table;
      out.push({ game, table, label, columns, values: best.values, at: best.at, place: placeOf(list, columns, best) });
    }
    return out.sort((a, b) => a.game.localeCompare(b.game) || a.label.localeCompare(b.label));
  }

  /** Кусок HTML для страницы игры (пререндер оставляет место, сервер вписывает свежие таблицы). */
  html(game: string, max = 3, rows = 5): string {
    const columns = columnsFor(game, this.defs);
    if (!columns) return '';
    const tables = this.tablesOf(game)
      .filter((t) => !t.id.endsWith(HELP_SUFFIX))
      .slice(0, max);
    if (!tables.length) return '<p class="rec-empty">Рекордов пока нет — станьте первым.</p>';
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    return tables
      .map((t) => {
        const list = ranked(this.store.get(boardKey(game, t.id)), columns, 'all', undefined, Date.now(), rows);
        return `<h3>${esc(t.label)}</h3><ol class="rec-list">${list
          .map((e) => `<li><span class="rec-name">${esc(e.name)}</span> ${columns.map((c) => `<b>${esc(fmtValue(c, e.values[c.key]))}</b>`).join(' ')}</li>`)
          .join('')}</ol>`;
      })
      .join('\n');
  }
}
