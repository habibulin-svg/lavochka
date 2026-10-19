/* Таблицы рекордов в браузере: окно с разделами (всё время / месяц / неделя / мои), запись результата после партии.
 * Общая часть (столбцы, сравнение, переигрывание) — core/records.ts; хранение — на сервере (/api/records). */
import { Sound } from './audio';
import { serverBase } from './net/ws';
import { fmtValue, HELP_SUFFIX, PERIODS, soloSeats, type Claim, type RecordColumn, type RecordPeriod, type Replay } from './records';
import { saveSettings, settings, store } from './settings';
import type { Authority } from './authority';
import { modal } from './ui';
import { esc, h, uid } from './util';
import './records.css';

/** Метка устройства для «моих» рекордов (до аккаунтов этапа 3). Живёт в localStorage, наружу таблица её не отдаёт. */
export function deviceId(): string {
  let id = store.get<string>('records.device', '');
  if (!/^[\w-]{6,64}$/.test(id)) store.set('records.device', (id = uid() + uid()));
  return id;
}

export interface Row {
  name: string;
  values: Record<string, number>;
  at: number;
  me?: boolean;
}
export interface BoardData {
  table: string;
  tables: { id: string; label: string; n: number }[];
  columns: RecordColumn[];
  rows: Row[];
}

export async function fetchBoard(game: string, table: string | undefined, period: RecordPeriod): Promise<BoardData | null> {
  const q = new URLSearchParams({ game, period, device: deviceId() });
  if (table) q.set('table', table);
  try {
    const r = await fetch(`${serverBase()}/api/records?${q}`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export interface Posted {
  ok: boolean;
  error?: string;
  table?: string;
  values?: Record<string, number>;
  place?: number;
  placeWeek?: number;
}

export async function postClaim(claim: Claim): Promise<Posted | null> {
  try {
    const r = await fetch(`${serverBase()}/api/records`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...claim, device: deviceId() }),
    });
    return await r.json().catch(() => ({ ok: false, error: String(r.status) }));
  } catch {
    return null;
  }
}

const when = (t: number) => {
  if (!t) return '';
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
};

/** Таблица рекордов игры: выбор таблицы (вариант), разделы, строки. `table` — открыть на этой; columns — пока сервер молчит. */
export function recordsBox(game: string, o: { table?: string; label?: string; columns?: RecordColumn[]; period?: RecordPeriod; rows?: number } = {}): HTMLElement {
  const el = h(`<div class="recs">
    <select class="recs-table" hidden></select><div class="recs-cap" hidden></div>
    <div class="recs-periods">${PERIODS.map((p) => `<button data-p="${p.id}">${p.label}</button>`).join('')}</div>
    <div class="recs-body"><p class="recs-empty">…</p></div>
  </div>`);
  const sel = el.querySelector('.recs-table') as HTMLSelectElement;
  const body = el.querySelector('.recs-body') as HTMLElement;
  const cap = el.querySelector('.recs-cap') as HTMLElement;
  let table = o.table;
  let period: RecordPeriod = o.period ?? 'all';
  let gen = 0;
  const draw = async () => {
    const my = ++gen;
    el.querySelectorAll<HTMLButtonElement>('.recs-periods button').forEach((b) => b.classList.toggle('on', b.dataset.p === period));
    const d = await fetchBoard(game, table, period);
    if (my !== gen) return;
    if (!d) {
      body.innerHTML = '<p class="recs-empty">Нет связи с сервером — таблица появится, когда он ответит.</p>';
      return;
    }
    table = d.table || table;
    const tables = d.tables.slice();
    if (table && !tables.some((t) => t.id === table)) tables.unshift({ id: table, label: o.label ?? table, n: 0 });
    sel.innerHTML = tables.map((t) => `<option value="${esc(t.id)}"${t.id === table ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
    sel.hidden = tables.length < 2;
    cap.hidden = tables.length !== 1;
    cap.textContent = tables[0]?.label ?? '';
    const cols = d.columns.length ? d.columns : (o.columns ?? []);
    if (!d.rows.length) {
      body.innerHTML = `<p class="recs-empty">${period === 'mine' ? 'Своих рекордов здесь пока нет.' : 'Пока пусто — станьте первым.'}</p>`;
      return;
    }
    body.innerHTML = `<table class="recs-list"><thead><tr><th>#</th><th>Имя</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}<th class="recs-at">Когда</th></tr></thead><tbody>${d.rows
      .slice(0, o.rows ?? 20)
      .map(
        (r, i) =>
          `<tr class="${r.me ? 'me' : ''}${i < 3 ? ` top${i + 1}` : ''}"><td>${i + 1}</td><td class="recs-name">${esc(r.name)}</td>${cols.map((c) => `<td>${esc(fmtValue(c, r.values[c.key]))}</td>`).join('')}<td class="recs-at">${when(r.at)}</td></tr>`
      )
      .join('')}</tbody></table>`;
  };
  sel.onchange = () => {
    table = sel.value;
    void draw();
  };
  el.querySelectorAll<HTMLButtonElement>('.recs-periods button').forEach(
    (b) =>
      (b.onclick = () => {
        Sound.ui();
        period = b.dataset.p as RecordPeriod;
        void draw();
      })
  );
  void draw();
  return el;
}

/** Окно «Рекорды» (меню стола, карточка игры). */
export function openRecords(game: string, title: string, o: { table?: string; label?: string; columns?: RecordColumn[] } = {}) {
  const body = h(`<div><h2>Рекорды: ${esc(title)}</h2></div>`);
  body.appendChild(recordsBox(game, o));
  modal(body, [{ text: 'Закрыть', primary: true }], { wide: true, cls: 'recs-modal' });
}

// ------------------------------------------------------------------ результат партии

/** Что можно записать после партии: таблица, итог (для показа — сервер всё равно пересчитает) и запись партии. */
export interface Offer {
  game: string;
  table: string;
  label: string;
  help: boolean;
  columns: RecordColumn[];
  values: Record<string, number>;
  claim: Omit<Claim, 'name'>;
  /** Имя места за столом — подсказка, пока своё имя не задано. */
  who?: string;
}

/** Предложение рекорда из законченной локальной партии (пошаговая игра с `def.records`). */
export function offerFrom(auth: Authority): Offer | null {
  const rec = auth.def.records;
  if (!rec || !auth.result || !auth.log || auth.seed == null || !soloSeats(auth.seats)) return null;
  const t = rec.table(auth.options);
  if (!t) return null;
  const actions = auth.log.map((x) => x[1]);
  let sc;
  try {
    sc = rec.score(auth.state, { ms: auth.playMs, actions, opts: auth.options });
  } catch {
    return null;
  }
  if (!sc) return null;
  const replay: Replay = { seed: auth.seed, t0: auth.t0, options: auth.options, seats: auth.seats, log: auth.log };
  const table = t.id + (sc.help ? HELP_SUFFIX : '');
  return { game: auth.def.id, table, label: t.label + (sc.help ? ', с подсказками' : ''), help: !!sc.help, columns: rec.columns, values: sc.values, claim: { game: auth.def.id, replay }, who: auth.seats[0].name };
}

/** Свои лучшие на этом устройстве — чтобы сказать «это ваш лучший» даже без сервера. */
function localBest(o: Offer): boolean {
  const key = `records.best.${o.game}/${o.table}`;
  const prev = store.get<Record<string, number> | null>(key, null);
  const cmp = (a: Record<string, number>, b: Record<string, number>) => {
    for (const c of o.columns) {
      const x = a[c.key] ?? 0;
      const y = b[c.key] ?? 0;
      if (x !== y) return c.sort === 'asc' ? x - y : y - x;
    }
    return 0;
  };
  const better = !prev || cmp(o.values, prev) < 0;
  if (better) store.set(key, o.values);
  return better;
}

/** Блок рекорда в окне итогов: итог, имя, «Записать», после записи — место и таблица. */
export function offerBlock(o: Offer): HTMLElement {
  const best = localBest(o);
  const vals = o.columns.map((c) => `${esc(c.label)}: <b>${esc(fmtValue(c, o.values[c.key]))}</b>`).join(', ');
  const el = h(`<div class="recs-offer">
    <p class="recs-res">${best ? '🏆 Ваш лучший результат! ' : ''}${vals}<br><small>Таблица: ${esc(o.label)}</small></p>
    ${o.help ? '<p class="recs-note">Были отмена хода или подсказка — результат пойдёт в отдельную таблицу «с подсказками».</p>' : ''}
    <div class="recs-send"><input class="recs-input" maxlength="16" placeholder="Ваше имя" value="${esc(settings.name || o.who || '')}"><button class="btn primary">Записать в рекорды</button></div>
    <div class="recs-after"></div>
  </div>`);
  const input = el.querySelector('input') as HTMLInputElement;
  const btn = el.querySelector('.recs-send button') as HTMLButtonElement;
  const after = el.querySelector('.recs-after') as HTMLElement;
  const send = async () => {
    Sound.ui();
    const name = input.value.trim() || 'Аноним';
    if (settings.name !== name) {
      settings.name = name;
      saveSettings();
    }
    btn.disabled = true;
    input.disabled = true;
    btn.textContent = 'Записываю…';
    const r = await postClaim({ ...o.claim, name });
    if (!r?.ok) {
      btn.disabled = false;
      input.disabled = false;
      btn.textContent = 'Ещё раз';
      after.innerHTML = `<p class="recs-note">${!r ? 'Нет связи с сервером.' : r.error === 'often' ? 'Слишком часто — попробуйте через пару минут.' : 'Сервер не принял результат: партия не сошлась при проверке.'}</p>`;
      return;
    }
    el.querySelector('.recs-send')!.remove();
    after.innerHTML = `<p class="recs-place">${r.place ? `Место в таблице: <b>${r.place}</b>${r.placeWeek && r.placeWeek !== r.place ? ` (за неделю — ${r.placeWeek})` : ''}` : 'Записано — до таблицы лучших пока не дотянули.'}</p>`;
    after.appendChild(recordsBox(o.game, { table: r.table ?? o.table, label: o.label, columns: o.columns, period: r.place ? 'all' : 'mine', rows: 10 }));
  };
  btn.onclick = () => void send();
  input.onkeydown = (e) => {
    if (e.key === 'Enter') void send();
  };
  return el;
}
