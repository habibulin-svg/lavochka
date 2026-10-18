/* Поля задач «А у нас во дворе»: у каждого типа своё. Поле держит черновик игрока (живёт, пока не сменилась задача),
 * отдаёт ответ, применяет подсказки и показывает решение. */
import { esc, h } from '../../core/util';
import type { Hint } from './kinds';
import { spansOf, type HashiData } from './kinds/hashi';
import type { HidatoData } from './kinds/hidato';
import type { KazakiData, OknoData } from './kinds/liars';
import type { ZebraData } from './kinds/zebra';

export interface Pad {
  el: HTMLElement;
  /** Ответ; null — не всё заполнено (тогда «Проверить» подскажет, чего не хватает). */
  answer(): unknown | null;
  hints(hs: Hint[]): void;
  solution(sol: unknown): void;
  /** Только смотреть (показ правил, задача закрыта). */
  lock(): void;
}

type Changed = () => void;

// ---------------------------------------------------------------- кто где

function zebraPad(d: ZebraData, changed: Changed): Pad {
  const n = d.names.length;
  const k = d.cats.length;
  // сетка: верхний ряд блоков — имена × каждый признак; дальше признак (k-1…1) × признаки левее
  const rows: { title: string; labels: string[]; ref: number }[] = [{ title: 'Ребята', labels: d.names, ref: -1 }];
  for (let r = k - 1; r >= 1; r--) rows.push({ title: d.cats[r].title, labels: d.cats[r].vals, ref: r });
  /** marks[key] = 0 пусто, 1 ✕, 2 ✓; key = `${a}|${i}|${c}|${v}` (a — строка-признак, -1 имена). */
  const marks = new Map<string, number>();
  const ans: number[][] = d.cats.map(() => new Array(n).fill(-1));
  const locked = new Set<string>();
  const el = h(`<div class="dv-zebra"></div>`);
  const ol = h(`<ol class="dv-clues">${d.clues.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>`);
  ol.addEventListener('click', (e) => (e.target as HTMLElement).closest('li')?.classList.toggle('used'));
  el.appendChild(ol);
  // сетка нарисована ручкой, как поле в морском бое: SVG, линии с дрожанием, подписи почерком
  const C = 28;
  const chars = (xs: string[]) => Math.max(...xs.map((x) => x.length));
  const L = Math.round(chars(rows.flatMap((r) => r.labels)) * 8.6) + 16;
  const T = Math.round(chars(d.cats.flatMap((c) => c.vals)) * 8.6) + 34;
  const W = L + k * n * C + 6;
  const H = T + rows.length * n * C + 6;
  let seed = n * 977 + k * 131 + d.clues.length;
  const j = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return ((seed / 0x7fffffff) - 0.5) * 2.2;
  };
  const line = (x1: number, y1: number, x2: number, y2: number, w: number) =>
    `<path class="dv-ink" stroke-width="${w}" d="M${(x1 + j()).toFixed(1)} ${(y1 + j()).toFixed(1)}Q${((x1 + x2) / 2 + j()).toFixed(1)} ${((y1 + y2) / 2 + j()).toFixed(1)} ${(x2 + j()).toFixed(1)} ${(y2 + j()).toFixed(1)}"/>`;
  let ink = '';
  let txt = '';
  let hits = '';
  // заголовки столбцов: признак и значения (повёрнуты)
  d.cats.forEach((c, ci) => {
    const x0 = L + ci * n * C;
    txt += `<text class="dv-hcat" x="${x0 + (n * C) / 2}" y="20">${esc(c.title)}</text>`;
    c.vals.forEach((v, vi) => (txt += `<text class="dv-hval" transform="translate(${x0 + vi * C + C / 2 + 6} ${T - 6}) rotate(-90)">${esc(v)}</text>`));
  });
  rows.forEach((r, ri) => {
    const y0 = T + ri * n * C;
    r.labels.forEach((lab, i) => (txt += `<text class="dv-hrow" x="${L - 8}" y="${y0 + i * C + C / 2 + 6}">${esc(lab)}</text>`));
    d.cats.forEach((_, c) => {
      if (!(ri === 0 || r.ref > c)) return;
      const x0 = L + c * n * C;
      for (let q = 1; q < n; q++) {
        ink += line(x0 + q * C, y0, x0 + q * C, y0 + n * C, 1.1);
        ink += line(x0, y0 + q * C, x0 + n * C, y0 + q * C, 1.1);
      }
      ink += line(x0, y0, x0 + n * C, y0, 2.4) + line(x0, y0 + n * C, x0 + n * C, y0 + n * C, 2.4);
      ink += line(x0, y0, x0, y0 + n * C, 2.4) + line(x0 + n * C, y0, x0 + n * C, y0 + n * C, 2.4);
      r.labels.forEach((_, i) => {
        for (let v = 0; v < n; v++) hits += `<rect class="dv-hit" x="${x0 + v * C}" y="${y0 + i * C}" width="${C}" height="${C}" data-key="${r.ref}|${i}|${c}|${v}"/><g class="dv-mk" data-mk="${r.ref}|${i}|${c}|${v}" transform="translate(${x0 + v * C} ${y0 + i * C})"></g>`;
      });
    });
  });
  const grid = h(`<div class="dv-zscroll"><svg class="dv-zsvg" viewBox="0 0 ${W} ${H}" style="width:max(100%, ${Math.round(W * 0.82)}px);max-width:${W}px">${txt}${ink}${hits}</svg></div>`);
  const cellEls = new Map<string, Element>();
  grid.querySelectorAll('[data-mk]').forEach((g) => cellEls.set((g as SVGElement).dataset.mk!, g));
  const draw = (key: string) => {
    const g = cellEls.get(key);
    if (!g) return;
    const m = marks.get(key) ?? 0;
    const cls = locked.has(key) ? 'dv-yes fixed' : m === 2 ? 'dv-yes' : 'dv-no';
    const w = () => j().toFixed(1);
    g.innerHTML =
      m === 2
        ? `<path class="${cls}" d="M${6 + +w()} ${15 + +w()}L${11 + +w()} ${21 + +w()}L${22 + +w()} ${6 + +w()}"/>`
        : m === 1
          ? `<path class="${cls}" d="M${8 + +w()} ${8 + +w()}L${20 + +w()} ${20 + +w()}M${20 + +w()} ${8 + +w()}L${8 + +w()} ${20 + +w()}"/>`
          : '';
  };
  const setMark = (key: string, m: number, auto = true) => {
    marks.set(key, m);
    draw(key);
    if (m === 2 && auto) {
      // ✓ вычёркивает строку и столбец своего блока
      const [a, i, c, v] = key.split('|').map(Number);
      for (let x = 0; x < n; x++) {
        if (x !== v && !(marks.get(`${a}|${i}|${c}|${x}`) ?? 0)) setMark(`${a}|${i}|${c}|${x}`, 1, false);
        if (x !== i && !(marks.get(`${a}|${x}|${c}|${v}`) ?? 0)) setMark(`${a}|${x}|${c}|${v}`, 1, false);
      }
      // ✓ у ребёнка — сразу в таблицу ответа
      if (a === -1) setAns(c, i, v);
    }
  };
  let off = false;
  grid.addEventListener('click', (e) => {
    if (off) return;
    const td = (e.target as Element).closest('.dv-hit') as SVGElement | null;
    if (!td?.dataset.key || locked.has(td.dataset.key)) return;
    const key = td.dataset.key;
    const m = ((marks.get(key) ?? 0) + 1) % 3;
    setMark(key, m);
    changed();
  });
  el.appendChild(grid);
  // таблица ответа
  const tab = h(`<table class="dv-ztab"><tr><th>Кто</th>${d.cats.map((c) => `<th>${esc(c.title)}</th>`).join('')}</tr></table>`);
  const sels: HTMLSelectElement[][] = d.cats.map(() => []);
  d.names.forEach((nm, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th>${esc(nm)}</th>`;
    d.cats.forEach((c, ci) => {
      const td = document.createElement('td');
      const sel = document.createElement('select');
      sel.innerHTML = `<option value="-1">…</option>` + c.vals.map((v, vi) => `<option value="${vi}">${esc(v)}</option>`).join('');
      sel.onchange = () => {
        ans[ci][i] = Number(sel.value);
        changed();
      };
      sels[ci][i] = sel;
      td.appendChild(sel);
      tr.appendChild(td);
    });
    tab.appendChild(tr);
  });
  const setAns = (c: number, i: number, v: number) => {
    ans[c][i] = v;
    sels[c][i].value = String(v);
  };
  el.appendChild(h(`<div class="dv-zans"><b>Ответ</b></div>`)).appendChild(tab);
  return {
    el,
    answer: () => (ans.every((r) => r.every((v) => v >= 0)) ? ans.map((r) => r.slice()) : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { c: number; i: number; v: number } | undefined;
        if (!r) continue;
        const key = `-1|${r.i}|${r.c}|${r.v}`;
        locked.add(key);
        setMark(key, 2);
        setAns(r.c, r.i, r.v);
        sels[r.c][r.i].disabled = true;
      }
    },
    solution(sol) {
      const s = sol as number[][];
      s.forEach((row, c) => row.forEach((v, i) => setAns(c, i, v)));
      for (const key of cellEls.keys()) {
        const [a, i, c, v] = key.split('|').map(Number);
        if (a !== -1) continue;
        marks.set(key, s[c][i] === v ? 2 : 1);
        draw(key);
      }
    },
    lock() {
      off = true;
      sels.flat().forEach((s) => (s.disabled = true));
      el.classList.add('locked');
    },
  };
}

// ---------------------------------------------------------------- классики

function hidatoPad(d: HidatoData, changed: Changed): Pad {
  const el = h(`<div class="dv-hid" style="--cols:${d.w};--rows:${d.h}"></div>`);
  const inputs: (HTMLInputElement | null)[] = [];
  const n = d.cells.filter((c) => c >= 0).length;
  d.cells.forEach((c) => {
    if (c < 0) {
      el.appendChild(h(`<div class="hole"></div>`));
      inputs.push(null);
    } else if (c > 0) {
      el.appendChild(h(`<div class="given${c === 1 || c === n ? ' end' : ''}">${c}</div>`));
      inputs.push(null);
    } else {
      const inp = h<HTMLInputElement>(`<input class="cell" inputmode="numeric" maxlength="2" autocomplete="off" aria-label="число">`);
      inp.oninput = () => {
        inp.value = inp.value.replace(/\D/g, '').slice(0, 2);
        changed();
      };
      el.appendChild(inp);
      inputs.push(inp);
    }
  });
  return {
    el,
    answer() {
      const out = d.cells.map((c, i) => (c < 0 ? -1 : c > 0 ? c : Number(inputs[i]!.value || 0)));
      return out.some((v, i) => d.cells[i] === 0 && !v) ? null : out;
    },
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number; v: number } | undefined;
        const inp = r && inputs[r.i];
        if (!inp) continue;
        inp.value = String(r.v);
        inp.readOnly = true;
        inp.classList.add('fixed');
      }
    },
    solution(sol) {
      (sol as number[]).forEach((v, i) => {
        const inp = inputs[i];
        if (inp && Number(inp.value) !== v) {
          inp.value = String(v);
          inp.classList.add('shown');
        }
      });
    },
    lock() {
      inputs.forEach((i) => i && (i.readOnly = true));
    },
  };
}

// ---------------------------------------------------------------- мостки

function hashiPad(d: HashiData, changed: Changed): Pad {
  const spans = spansOf(d);
  const val = spans.map(() => 0);
  const fixed = new Set<number>();
  const U = 40;
  const W = d.w * U;
  const H = d.h * U;
  const el = h(`<div class="dv-hashi"></div>`);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  el.appendChild(svg);
  const xy = (cell: number) => [((cell % d.w) + 0.5) * U, (((cell / d.w) | 0) + 0.5) * U];
  const lines = document.createElementNS(svgNS, 'g');
  const hits = document.createElementNS(svgNS, 'g');
  const isl = document.createElementNS(svgNS, 'g');
  svg.append(lines, hits, isl);
  let sel = -1;
  let off = false;
  const crossing = (i: number) => {
    const s = new Set(spans[i].cells);
    return spans.some((q, j) => j !== i && val[j] > 0 && q.a !== spans[i].a && q.a !== spans[i].b && q.b !== spans[i].a && q.b !== spans[i].b && q.cells.some((c) => s.has(c)));
  };
  const cycle = (i: number) => {
    if (fixed.has(i)) return;
    let v = (val[i] + 1) % 3;
    if (v > 0 && crossing(i)) v = 0;
    val[i] = v;
    draw();
    changed();
  };
  const draw = () => {
    lines.innerHTML = '';
    spans.forEach((sp, i) => {
      if (!val[i]) return;
      const [x1, y1] = xy(d.isl[sp.a].at);
      const [x2, y2] = xy(d.isl[sp.b].at);
      const horiz = y1 === y2;
      const offs = val[i] === 2 ? [-4, 4] : [0];
      for (const o of offs) {
        const ln = document.createElementNS(svgNS, 'line');
        ln.setAttribute('x1', String(x1 + (horiz ? 0 : o)));
        ln.setAttribute('y1', String(y1 + (horiz ? o : 0)));
        ln.setAttribute('x2', String(x2 + (horiz ? 0 : o)));
        ln.setAttribute('y2', String(y2 + (horiz ? o : 0)));
        ln.setAttribute('class', 'plank' + (fixed.has(i) ? ' fixed' : ''));
        lines.appendChild(ln);
      }
    });
    isl.innerHTML = '';
    d.isl.forEach((s, k) => {
      const [x, y] = xy(s.at);
      const sum = spans.reduce((t, sp, i) => t + (sp.a === k || sp.b === k ? val[i] : 0), 0);
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', 'brick' + (sum === s.n ? ' full' : sum > s.n ? ' over' : '') + (sel === k ? ' sel' : ''));
      g.dataset.k = String(k);
      g.innerHTML = `<rect x="${x - 15}" y="${y - 11}" width="30" height="22" rx="3"></rect><text x="${x}" y="${y + 6}">${s.n}</text>`;
      isl.appendChild(g);
    });
  };
  // промежутки — прозрачные полосы, по ним можно нажимать
  spans.forEach((sp, i) => {
    const [x1, y1] = xy(d.isl[sp.a].at);
    const [x2, y2] = xy(d.isl[sp.b].at);
    const r = document.createElementNS(svgNS, 'rect');
    const horiz = y1 === y2;
    r.setAttribute('x', String(Math.min(x1, x2) + (horiz ? 16 : -9)));
    r.setAttribute('y', String(Math.min(y1, y2) + (horiz ? -9 : 12)));
    r.setAttribute('width', String(horiz ? Math.abs(x2 - x1) - 32 : 18));
    r.setAttribute('height', String(horiz ? 18 : Math.abs(y2 - y1) - 24));
    r.setAttribute('class', 'gap');
    r.dataset.i = String(i);
    hits.appendChild(r);
  });
  svg.addEventListener('click', (e) => {
    if (off) return;
    const t = e.target as Element;
    const gap = t.closest('.gap') as SVGElement | null;
    if (gap) {
      sel = -1;
      cycle(Number(gap.dataset.i));
      return;
    }
    const br = t.closest('.brick') as SVGElement | null;
    if (!br) return;
    const k = Number(br.dataset.k);
    if (sel < 0 || sel === k) {
      sel = sel === k ? -1 : k;
      draw();
      return;
    }
    const i = spans.findIndex((sp) => (sp.a === sel && sp.b === k) || (sp.a === k && sp.b === sel));
    sel = i >= 0 ? -1 : k;
    if (i >= 0) cycle(i);
    else draw();
  });
  draw();
  return {
    el,
    answer: () => val.slice(),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number; v: number } | undefined;
        if (!r) continue;
        val[r.i] = r.v;
        fixed.add(r.i);
      }
      draw();
    },
    solution(sol) {
      (sol as number[]).forEach((v, i) => (val[i] = v));
      draw();
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- кто разбил / казаки

function oknoPad(d: OknoData, changed: Changed): Pad {
  let pick = -1;
  const out = new Set<number>();
  const el = h(`<div class="dv-say"></div>`);
  const truth = ['никто не сказал правду', 'правду сказал только один', 'правду сказали ровно двое', 'правду сказали ровно трое', 'правду сказали ровно четверо'][d.truth] ?? `правду сказали ${d.truth}`;
  const rows = d.names.map((nm, i) => {
    const r = h(`<label class="row"><input type="radio" name="dv-okno"><b>${esc(nm)}:</b> <span>«${esc(d.says[i].replace(/[.!]$/, ''))}»</span></label>`);
    const inp = r.querySelector('input')!;
    inp.onchange = () => {
      pick = i;
      changed();
    };
    el.appendChild(r);
    return { r, inp };
  });
  el.appendChild(h(`<p class="dv-known">Известно: <b>${truth}</b>. Кто разбил? Отметьте виновника.</p>`));
  return {
    el,
    answer: () => (pick >= 0 ? pick : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { not: number } | undefined;
        if (r?.not == null) continue;
        out.add(r.not);
        rows[r.not].r.classList.add('cleared');
        rows[r.not].inp.disabled = true;
      }
    },
    solution(sol) {
      rows[sol as number].r.classList.add('guilty');
      rows[sol as number].inp.checked = true;
    },
    lock() {
      rows.forEach((x) => (x.inp.disabled = true));
    },
  };
}

function kazakiPad(d: KazakiData, changed: Changed): Pad {
  const ans: (boolean | null)[] = d.names.map(() => null);
  const el = h(`<div class="dv-say"></div>`);
  const rows = d.names.map((nm, i) => {
    const r = h(`<div class="row kz"><div><b>${esc(nm)}:</b> «${esc(d.says[i].replace(/\.$/, ''))}»</div>
      <div class="kz-pick"><button class="btn small" data-v="0">казак</button><button class="btn small" data-v="1">разбойник</button></div></div>`);
    const bs = [...r.querySelectorAll('button')] as HTMLButtonElement[];
    const set = (v: boolean | null) => {
      ans[i] = v;
      bs.forEach((b) => b.classList.toggle('on', v != null && (b.dataset.v === '1') === v));
    };
    bs.forEach((b) =>
      b.addEventListener('click', () => {
        set(ans[i] === (b.dataset.v === '1') ? null : b.dataset.v === '1');
        changed();
      }),
    );
    el.appendChild(r);
    return { r, bs, set };
  });
  return {
    el,
    answer: () => (ans.every((v) => v != null) ? ans.slice() : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number; v: boolean } | undefined;
        if (!r) continue;
        rows[r.i].set(r.v);
        rows[r.i].bs.forEach((b) => (b.disabled = true));
      }
    },
    solution(sol) {
      (sol as boolean[]).forEach((v, i) => rows[i].set(v));
    },
    lock() {
      rows.forEach((x) => x.bs.forEach((b) => (b.disabled = true)));
    },
  };
}

export function makePad(kind: string, data: unknown, changed: Changed): Pad {
  switch (kind) {
    case 'zebra':
      return zebraPad(data as ZebraData, changed);
    case 'hidato':
      return hidatoPad(data as HidatoData, changed);
    case 'hashi':
      return hashiPad(data as HashiData, changed);
    case 'okno':
      return oknoPad(data as OknoData, changed);
    case 'kazaki':
      return kazakiPad(data as KazakiData, changed);
  }
  return { el: h(`<div>?</div>`), answer: () => null, hints() {}, solution() {}, lock() {} };
}
