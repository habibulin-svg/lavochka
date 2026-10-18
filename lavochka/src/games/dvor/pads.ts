/* Поля задач «А у нас во дворе»: у каждого типа своё. Поле держит черновик игрока (живёт, пока не сменилась задача),
 * отдаёт ответ, применяет подсказки и показывает решение. */
import { esc, h } from '../../core/util';
import type { Hint } from './kinds';
import { spansOf, type HashiData } from './kinds/hashi';
import type { HidatoData } from './kinds/hidato';
import type { KazakiData, OknoData } from './kinds/liars';
import type { ZebraData } from './kinds/zebra';
import type { BullsData } from './kinds/bulls';
import { fant, gen as genOf, type ChainData } from './kinds/chain';
import { OP_SIGN, type KenkenData } from './kinds/kenken';
import type { StopkiData } from './kinds/stopki';
import { ABC, type ClockData } from './kinds/clock';
import type { OstatkiData } from './kinds/ostatki';
import { GOODS, type ShopData } from './kinds/shop';
import type { ZadachkaData } from './kinds/zadachki';
import type { KakuroData, KratData, MirrorData, RaskData } from './kinds/paint';
import type { GearsAns, GearsData, TurnirData, ZemData } from './kinds/mech';
import { COLORS, type Fig, type KartinkaData, type MatrixData, type OdinData, type VennData } from './kinds/misc';
import type { FonariData } from './kinds/fonari';
import { VEG, VEG_NAMES, type GryadkiData } from './kinds/gryadki';
import type { PalatkiData } from './kinds/palatki';
import type { ShikakuData } from './kinds/shikaku';
import { open, type LabData } from './kinds/labirint';
import type { MorboyData } from './kinds/morboy';
import type { SaperData } from './kinds/saper';
import { ARROWS, type StrelkiData } from './kinds/strelki';

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

// ---------------------------------------------------------------- клетки с цифрой (общие для быков, стопок, квадрата)

function digitCell(max: number, changed: Changed, cls = 'cell'): HTMLInputElement {
  const inp = h<HTMLInputElement>(`<input class="${cls}" inputmode="numeric" maxlength="1" autocomplete="off" aria-label="цифра">`);
  inp.oninput = () => {
    const v = inp.value.replace(/\D/g, '').slice(-1);
    inp.value = v !== '' && Number(v) <= max ? v : '';
    inp.dataset.v = inp.value;
    changed();
  };
  // стрелки — по соседним клеткам
  inp.addEventListener('keydown', (e) => {
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) return;
    const grid = inp.closest('[data-grid]') as HTMLElement | null;
    const all = [...(grid?.querySelectorAll('input') ?? [])] as HTMLInputElement[];
    const cols = Number(grid?.dataset.grid || all.length);
    const i = all.indexOf(inp);
    const j = k === 'ArrowLeft' ? i - 1 : k === 'ArrowRight' ? i + 1 : k === 'ArrowUp' ? i - cols : i + cols;
    if (all[j]) {
      all[j].focus();
      e.preventDefault();
    }
  });
  return inp;
}

function setCell(inp: HTMLInputElement, v: number, cls: 'fixed' | 'shown') {
  inp.value = String(v);
  inp.dataset.v = inp.value;
  inp.classList.add(cls);
  if (cls === 'fixed') inp.readOnly = true;
}

// ---------------------------------------------------------------- быки и коровы

function bullsPad(d: BullsData, changed: Changed): Pad {
  const el = h(`<div class="dv-bulls"></div>`);
  const tab = h(`<table class="dv-btab"><tr><th>Попытка</th><th>Быки</th><th>Коровы</th></tr></table>`);
  for (const q of d.guesses)
    tab.appendChild(
      h(`<tr><td class="code">${q.g.map((x) => `<i>${x}</i>`).join('')}</td><td>${'🐂'.repeat(q.b)}<b>${q.b}</b></td><td>${'🐄'.repeat(q.c)}<b>${q.c}</b></td></tr>`),
    );
  el.appendChild(tab);
  const row = h(`<div class="dv-bans" data-grid="${d.len}"><b>Код:</b></div>`);
  const inputs = Array.from({ length: d.len }, () => row.appendChild(digitCell(9, changed)));
  el.appendChild(row);
  el.appendChild(h(`<p class="dv-known">Цифры в коде не повторяются.</p>`));
  return {
    el,
    answer: () => (inputs.every((i) => i.value !== '') ? inputs.map((i) => Number(i.value)) : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number; v: number } | undefined;
        if (r) setCell(inputs[r.i], r.v, 'fixed');
      }
    },
    solution(sol) {
      (sol as number[]).forEach((v, i) => Number(inputs[i].value) !== v && setCell(inputs[i], v, 'shown'));
    },
    lock() {
      inputs.forEach((i) => (i.readOnly = true));
    },
  };
}

// ---------------------------------------------------------------- стопки

function stopkiPad(d: StopkiData, changed: Changed): Pad {
  const { n } = d;
  const el = h(`<div class="dv-stopki" data-grid="${n}" style="--n:${n + 2}"></div>`);
  const inputs: (HTMLInputElement | null)[] = [];
  const clue = (v: number, side: string) => el.appendChild(h(`<div class="clue ${side}">${v || ''}</div>`));
  const corner = () => el.appendChild(h(`<div></div>`));
  corner();
  d.top.forEach((v) => clue(v, 'top'));
  corner();
  for (let r = 0; r < n; r++) {
    clue(d.left[r], 'left');
    for (let c = 0; c < n; c++) {
      const g = d.given[r * n + c];
      if (g) {
        el.appendChild(h(`<div class="given" data-v="${g}">${g}</div>`));
        inputs.push(null);
      } else inputs.push(el.appendChild(digitCell(n, changed)));
    }
    clue(d.right[r], 'right');
  }
  corner();
  d.bottom.forEach((v) => clue(v, 'bottom'));
  corner();
  return {
    el,
    answer() {
      const out = d.given.map((g, i) => g || Number(inputs[i]!.value || 0));
      return out.some((v) => !v) ? null : out;
    },
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number; v: number } | undefined;
        const inp = r && inputs[r.i];
        if (inp) setCell(inp, r.v, 'fixed');
      }
    },
    solution(sol) {
      (sol as number[]).forEach((v, i) => {
        const inp = inputs[i];
        if (inp && Number(inp.value) !== v) setCell(inp, v, 'shown');
      });
    },
    lock() {
      inputs.forEach((i) => i && (i.readOnly = true));
    },
  };
}

// ---------------------------------------------------------------- квадрат

function kenkenPad(d: KenkenData, changed: Changed): Pad {
  const { n } = d;
  const cageOf = new Array(n * n).fill(-1);
  d.cages.forEach((c, k) => c.cells.forEach((i) => (cageOf[i] = k)));
  const el = h(`<div class="dv-kenken" data-grid="${n}" style="--n:${n}"></div>`);
  const inputs: HTMLInputElement[] = [];
  for (let i = 0; i < n * n; i++) {
    const r = (i / n) | 0;
    const c = i % n;
    const k = cageOf[i];
    const cage = d.cages[k];
    // жирная линия — граница загона
    const b = [r === 0 || cageOf[i - n] !== k, c === n - 1 || cageOf[i + 1] !== k, r === n - 1 || cageOf[i + n] !== k, c === 0 || cageOf[i - 1] !== k];
    const box = h(`<div class="kk" style="border-width:${b.map((x) => (x ? '3px' : '1px')).join(' ')}"></div>`);
    if (cage.cells[0] === i) box.appendChild(h(`<span class="lab">${cage.v}${OP_SIGN[cage.op]}</span>`));
    inputs.push(box.appendChild(digitCell(n, changed)));
    el.appendChild(box);
  }
  return {
    el,
    answer: () => (inputs.every((i) => i.value !== '') ? inputs.map((i) => Number(i.value)) : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number; v: number } | undefined;
        if (r) setCell(inputs[r.i], r.v, 'fixed');
      }
    },
    solution(sol) {
      (sol as number[]).forEach((v, i) => Number(inputs[i].value) !== v && setCell(inputs[i], v, 'shown'));
    },
    lock() {
      inputs.forEach((i) => (i.readOnly = true));
    },
  };
}

// ---------------------------------------------------------------- фантики

function chainPad(d: ChainData, changed: Changed): Pad {
  const el = h(`<div class="dv-chain"></div>`);
  el.appendChild(h(`<p>У ${esc(genOf(d.hero))} было <b>${fant(d.start)}</b>.</p>`));
  const ol = h(`<ol>${d.steps.map((s) => `<li>${esc(s.text)}<em></em></li>`).join('')}</ol>`);
  el.appendChild(ol);
  const ask = h(`<label class="dv-cask">${esc(d.ask)} <input class="cell wide" inputmode="numeric" maxlength="3" autocomplete="off" aria-label="ответ"></label>`);
  const inp = ask.querySelector('input') as HTMLInputElement;
  inp.oninput = () => {
    inp.value = inp.value.replace(/\D/g, '').slice(0, 3);
    changed();
  };
  el.appendChild(ask);
  const lis = [...ol.querySelectorAll('li')];
  return {
    el,
    answer: () => (inp.value ? Number(inp.value) : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { at: number; v: number } | undefined;
        const em = r && lis[r.at - 1]?.querySelector('em');
        if (em) em.textContent = ` → ${fant(r.v)}`;
      }
    },
    solution(sol) {
      if (Number(inp.value) !== sol) {
        inp.value = String(sol);
        inp.classList.add('shown');
      }
    },
    lock() {
      inp.readOnly = true;
    },
  };
}

// ---------------------------------------------------------------- ответ — одно число (лишний, задачка, магазин)

function numAnswer(label: string, changed: Changed, unit = ''): { el: HTMLElement; inp: HTMLInputElement } {
  const el = h(`<label class="dv-cask">${esc(label)} <input class="cell wide" inputmode="numeric" maxlength="5" autocomplete="off" aria-label="ответ">${unit ? ` <span>${esc(unit)}</span>` : ''}</label>`);
  const inp = el.querySelector('input') as HTMLInputElement;
  inp.oninput = () => {
    inp.value = inp.value.replace(/\D/g, '').slice(0, 5);
    changed();
  };
  return { el, inp };
}

function numPad(body: HTMLElement, label: string, changed: Changed, unit = ''): Pad {
  const el = h(`<div class="dv-chain"></div>`);
  el.appendChild(body);
  const { el: ask, inp } = numAnswer(label, changed, unit);
  el.appendChild(ask);
  return {
    el,
    answer: () => (inp.value ? Number(inp.value) : null),
    hints() {},
    solution(sol) {
      if (Number(inp.value) !== sol) {
        inp.value = String(sol);
        inp.classList.add('shown');
      }
    },
    lock() {
      inp.readOnly = true;
    },
  };
}

// ---------------------------------------------------------------- шифр по часам

/** Циферблат: часовая стрелка сдвигается с минутами, как на настоящих часах. */
function clockSvg(h0: number, m: number, cls = ''): string {
  const ha = ((h0 % 12) + m / 60) * 30;
  const ma = m * 6;
  const hand = (a: number, len: number, w: number) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return `<line x1="30" y1="30" x2="${(30 + Math.cos(rad) * len).toFixed(1)}" y2="${(30 + Math.sin(rad) * len).toFixed(1)}" stroke-width="${w}"/>`;
  };
  let ticks = '';
  for (let k = 0; k < 12; k++) {
    const rad = ((k * 30 - 90) * Math.PI) / 180;
    const big = k % 3 === 0;
    ticks += `<line class="tk" x1="${(30 + Math.cos(rad) * (big ? 21 : 23)).toFixed(1)}" y1="${(30 + Math.sin(rad) * (big ? 21 : 23)).toFixed(1)}" x2="${(30 + Math.cos(rad) * 26).toFixed(1)}" y2="${(30 + Math.sin(rad) * 26).toFixed(1)}" stroke-width="${big ? 2.4 : 1.3}"/>`;
  }
  return `<svg class="dv-clk ${cls}" viewBox="0 0 60 60"><circle cx="30" cy="30" r="27"/>${ticks}<g class="hands">${hand(ha, 14, 3.4)}${hand(ma, 22, 2)}</g><circle class="pin" cx="30" cy="30" r="2"/></svg>`;
}

function clockPad(d: ClockData, changed: Changed): Pad {
  const el = h(`<div class="dv-clock"></div>`);
  if (d.rule) el.appendChild(h(`<p class="dv-known">Ключ: <b>${esc(d.rule)}</b>. А — 1, Б — 2, … Я — 32 (буквы Ё нет).</p>`));
  else if (d.example) {
    el.appendChild(h(`<p class="dv-known">Ключ разбойники не говорят. Зато у казаков есть расшифрованное слово <b>${esc(d.example.word)}</b>. А — 1, Б — 2, … Я — 32 (буквы Ё нет).</p>`));
    el.appendChild(h(`<div class="dv-clks ex">${d.example.times.map((t, i) => `<figure>${clockSvg(t[0], t[1])}<figcaption>${esc(d.example!.word[i])}</figcaption></figure>`).join('')}</div>`));
  }
  el.appendChild(h(`<p class="dv-known">Записка:</p>`));
  const row = h(`<div class="dv-clks"></div>`);
  const caps: HTMLElement[] = [];
  d.times.forEach((t) => {
    if (!t) {
      row.appendChild(h(`<i class="sp"></i>`));
      return;
    }
    const f = h(`<figure>${clockSvg(t[0], t[1])}<figcaption></figcaption></figure>`);
    caps.push(f.querySelector('figcaption') as HTMLElement);
    row.appendChild(f);
  });
  el.appendChild(row);
  // азбука с номерами — чтобы не пересчитывать на пальцах
  el.appendChild(h(`<div class="dv-abc">${ABC.split('').map((c, i) => `<span><b>${c}</b>${i + 1}</span>`).join('')}</div>`));
  const ask = h(`<label class="dv-cask">Записка: <input class="cell word" autocomplete="off" aria-label="расшифровка"></label>`);
  const inp = ask.querySelector('input') as HTMLInputElement;
  inp.oninput = () => {
    inp.value = inp.value.toUpperCase().replace(/[^А-ЯЁ ]/g, '');
    changed();
  };
  el.appendChild(ask);
  // номер буквы в записке (без пробелов) → подпись под циферблатом
  const letterAt = (i: number) => d.times.slice(0, i).filter(Boolean).length;
  return {
    el,
    answer: () => (inp.value.trim() ? inp.value : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number; v: string } | undefined;
        if (r?.i == null) continue;
        const cap = caps[letterAt(r.i)];
        if (cap) cap.textContent = r.v;
      }
    },
    solution(sol) {
      const s = sol as string;
      [...s].forEach((c, i) => c !== ' ' && caps[letterAt(i)] && (caps[letterAt(i)].textContent = c));
      if (inp.value.replace(/\s/g, '').replace(/Ё/g, 'Е') !== s.replace(/\s/g, '')) {
        inp.value = s;
        inp.classList.add('shown');
      }
    },
    lock() {
      inp.readOnly = true;
    },
  };
}

// ---------------------------------------------------------------- магазин

function shopPad(d: ShopData, changed: Changed): Pad {
  const pics = (n: number[]) =>
    n
      .map((k, i) => (k ? `<span class="it">${(GOODS[d.goods[i]].icon + ' ').repeat(k).trim()}</span>` : ''))
      .filter(Boolean)
      .join('<b class="plus">+</b>');
  const body = h(`<div class="dv-shop">
      <p class="dv-known">Цены: ${d.goods.map((g) => `${GOODS[g].icon} ${esc(GOODS[g].name)}`).join(', ')}.</p>
      ${d.buys.map((b) => `<div class="buy">${pics(b.n)}<b class="eq">=</b><span class="sum">${b.sum} коп.</span></div>`).join('')}
      <div class="buy ask">${pics(d.ask)}<b class="eq">=</b><span class="sum">?</span></div>
    </div>`);
  const pad = numPad(body, 'Сколько стоит?', changed, 'коп.');
  const known = body.querySelector('.dv-known') as HTMLElement;
  pad.hints = (hs) => {
    for (const hnt of hs) {
      const r = hnt.reveal as { i: number; v: number } | undefined;
      if (r && !known.dataset[`k${r.i}`]) {
        known.dataset[`k${r.i}`] = '1';
        known.appendChild(h(`<span class="dv-got"> ${GOODS[d.goods[r.i]].icon} = ${r.v} коп.</span>`));
      }
    }
  };
  return pad;
}

// ---------------------------------------------------------------- лишний

function ostatkiPad(d: OstatkiData, changed: Changed): Pad {
  const lead = (m: number, r: number) =>
    r === 0 ? `по ${m} — все разбились ровно` : `по ${m} — ${r === 1 ? 'один лишний' : `${r} лишних`}`;
  const body = h(`<div><p>Делятся на ${esc(d.what)}:</p><ul>${d.splits.map((s) => `<li>${lead(s.m, s.r)};</li>`).join('')}</ul>
    <p>Ребят во дворе больше ${d.lo}, но меньше ${d.hi}.</p></div>`);
  return numPad(body, 'Сколько ребят?', changed);
}

// ---------------------------------------------------------------- задачка

function zadachkaPad(d: ZadachkaData, changed: Changed): Pad {
  const body = h(`<div><p>${esc(d.text)}</p><p><b>${esc(d.ask)}</b></p></div>`);
  return numPad(body, 'Ответ:', changed);
}

// ---------------------------------------------------------------- подвал (лабиринт)

function labPad(d: LabData, changed: Changed): Pad {
  const U = 30;
  const W = d.w * U;
  const H = d.h * U;
  const el = h(`<div class="dv-lab"></div>`);
  let walls = '';
  d.walls.forEach((m, i) => {
    const x = (i % d.w) * U;
    const y = ((i / d.w) | 0) * U;
    if (m & 1) walls += `M${x} ${y}h${U}`;
    if (m & 8) walls += `M${x} ${y}v${U}`;
    if (i % d.w === d.w - 1 && m & 2) walls += `M${x + U} ${y}v${U}`;
    if ((i / d.w | 0) === d.h - 1 && m & 4) walls += `M${x} ${y + U}h${U}`;
  });
  const cxy = (i: number) => [((i % d.w) + 0.5) * U, (((i / d.w) | 0) + 0.5) * U];
  const [sx, sy] = cxy(d.start);
  const [ex, ey] = cxy(d.end);
  el.innerHTML = `<svg viewBox="-4 -4 ${W + 8} ${H + 8}">
    <rect class="floor" x="0" y="0" width="${W}" height="${H}"/>
    <g class="hits">${d.walls.map((_, i) => `<rect x="${(i % d.w) * U}" y="${((i / d.w) | 0) * U}" width="${U}" height="${U}" data-i="${i}"/>`).join('')}</g>
    <polyline class="path" points=""/>
    <path class="wall" d="${walls}"/>
    <text class="mk" x="${sx}" y="${sy + 7}">🧒</text><text class="mk" x="${ex}" y="${ey + 7}">🚪</text>
  </svg>`;
  const line = el.querySelector('.path') as SVGPolylineElement;
  let path = [d.start];
  let fixed = 0;
  let off = false;
  const draw = () => line.setAttribute('points', path.map((i) => cxy(i).join(',')).join(' '));
  el.querySelector('svg')!.addEventListener('click', (e) => {
    if (off) return;
    const r = (e.target as Element).closest('[data-i]') as SVGElement | null;
    if (!r) return;
    const i = Number(r.dataset.i);
    const at = path.indexOf(i);
    if (at >= 0) path = path.slice(0, Math.max(at + 1, fixed));
    else {
      // по прямому коридору — сразу до нажатой клетки, без стен по дороге
      const last = path[path.length - 1];
      const step = (i % d.w) === (last % d.w) ? (i > last ? d.w : -d.w) : ((i / d.w) | 0) === ((last / d.w) | 0) ? (i > last ? 1 : -1) : 0;
      if (!step) return;
      const run: number[] = [];
      for (let c = last; c !== i; c += step) {
        if (!open(d, c, c + step) || path.includes(c + step)) return;
        run.push(c + step);
      }
      path.push(...run);
    }
    draw();
    changed();
  });
  draw();
  return {
    el,
    answer: () => (path[path.length - 1] === d.end ? path.slice() : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { path: number[] } | undefined;
        if (!r || r.path.length <= fixed) continue;
        path = r.path.slice();
        fixed = r.path.length;
      }
      draw();
    },
    solution(sol) {
      path = (sol as number[]).slice();
      draw();
      line.classList.add('shown');
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- стрелки

function strelkiPad(d: StrelkiData, changed: Changed): Pad {
  const N = d.n * d.n;
  const el = h(`<div class="dv-strelki" data-grid="${d.n}" style="--n:${d.n}"></div>`);
  const inputs: (HTMLInputElement | null)[] = [];
  for (let i = 0; i < N; i++) {
    const arrow = d.dir[i] < 0 ? '★' : ARROWS[d.dir[i]];
    const box = h(`<div class="st"><span class="ar">${arrow}</span></div>`);
    if (d.given[i]) {
      box.appendChild(h(`<b class="num">${d.given[i]}</b>`));
      box.classList.add('given');
      inputs.push(null);
    } else {
      const inp = h<HTMLInputElement>(`<input class="cell" inputmode="numeric" maxlength="2" autocomplete="off" aria-label="номер">`);
      inp.oninput = () => {
        inp.value = inp.value.replace(/\D/g, '').slice(0, 2);
        changed();
      };
      box.appendChild(inp);
      inputs.push(inp);
    }
    el.appendChild(box);
  }
  return {
    el,
    answer() {
      const out = d.given.map((g, i) => g || Number(inputs[i]!.value || 0));
      return out.some((v) => !v) ? null : out;
    },
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number; v: number } | undefined;
        const inp = r && inputs[r.i];
        if (inp) setCell(inp, r.v, 'fixed');
      }
    },
    solution(sol) {
      (sol as number[]).forEach((v, i) => {
        const inp = inputs[i];
        if (inp && Number(inp.value) !== v) setCell(inp, v, 'shown');
      });
    },
    lock() {
      inputs.forEach((i) => i && (i.readOnly = true));
    },
  };
}

// ---------------------------------------------------------------- сапёр

function saperPad(d: SaperData, changed: Changed): Pad {
  const el = h(`<div class="dv-saper" style="--w:${d.w}"></div>`);
  const flag = new Set<number>();
  const sure = new Set<number>();
  const boxes: HTMLElement[] = [];
  let off = false;
  const info = h(`<p class="dv-known">Мин на поле: <b>${d.mines}</b>. Отмечено: <b class="cnt">0</b>.</p>`);
  const cnt = info.querySelector('.cnt') as HTMLElement;
  const draw = (i: number) => {
    const b = boxes[i];
    b.classList.toggle('flag', flag.has(i));
    b.classList.toggle('sure', sure.has(i));
    b.textContent = flag.has(i) ? '💣' : '';
    cnt.textContent = String(flag.size);
  };
  d.open.forEach((v, i) => {
    const b = h(`<div class="${v < 0 ? 'cl' : 'op'}">${v > 0 ? v : ''}</div>`);
    if (v > 0) b.dataset.n = String(v);
    if (v < 0)
      b.addEventListener('click', () => {
        if (off || sure.has(i)) return;
        if (flag.has(i)) flag.delete(i);
        else flag.add(i);
        draw(i);
        changed();
      });
    boxes.push(b);
    el.appendChild(b);
  });
  const wrap = h(`<div class="dv-saperw"></div>`);
  wrap.append(info, el);
  return {
    el: wrap,
    answer: () => (flag.size === d.mines ? [...flag].sort((a, b) => a - b) : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number } | undefined;
        if (r?.i == null) continue;
        flag.add(r.i);
        sure.add(r.i);
        draw(r.i);
      }
    },
    solution(sol) {
      const s = new Set(sol as number[]);
      for (const i of [...flag]) if (!s.has(i)) boxes[i].classList.add('wrong');
      for (const i of s) {
        if (!flag.has(i)) boxes[i].classList.add('missed');
        flag.add(i);
        draw(i);
      }
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- морской бой по числам

function morboyPad(d: MorboyData, changed: Changed): Pad {
  const { n } = d;
  // 0 — пусто, 1 — палуба, 2 — вода (пометка)
  const st: number[] = d.shown.map((v) => (v === 2 ? 1 : v === 1 ? 2 : 0));
  const fixed = new Set(d.shown.map((v, i) => (v ? i : -1)).filter((i) => i >= 0));
  const el = h(`<div class="dv-morboy" style="--n:${n + 1}"></div>`);
  const boxes: HTMLElement[] = [];
  const rowEls: HTMLElement[] = [];
  const colEls: HTMLElement[] = [];
  let off = false;
  const sums = () => {
    for (let r = 0; r < n; r++) rowEls[r].classList.toggle('ok', st.slice(r * n, r * n + n).filter((v) => v === 1).length === d.rows[r]);
    for (let c = 0; c < n; c++) colEls[c].classList.toggle('ok', Array.from({ length: n }, (_, r) => st[r * n + c]).filter((v) => v === 1).length === d.cols[c]);
  };
  const draw = (i: number) => {
    boxes[i].className = `mb ${st[i] === 1 ? 'ship' : st[i] === 2 ? 'sea' : ''}${fixed.has(i) ? ' fixed' : ''}`;
  };
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const b = h(`<div></div>`);
      b.addEventListener('click', () => {
        if (off || fixed.has(i)) return;
        st[i] = (st[i] + 1) % 3;
        draw(i);
        sums();
        changed();
      });
      boxes.push(b);
      el.appendChild(b);
      draw(i);
    }
    rowEls.push(el.appendChild(h(`<div class="cnt">${d.rows[r]}</div>`)));
  }
  for (let c = 0; c < n; c++) colEls.push(el.appendChild(h(`<div class="cnt">${d.cols[c]}</div>`)));
  el.appendChild(h(`<div></div>`));
  const wrap = h(`<div class="dv-morboyw"><p class="dv-known">Флот: ${d.fleet.map((l) => `<span class="fl">${'■'.repeat(l)}</span>`).join(' ')}</p></div>`);
  wrap.appendChild(el);
  wrap.appendChild(h(`<p class="dv-known small">Нажатие: палуба → вода (пометка) → пусто.</p>`));
  sums();
  return {
    el: wrap,
    answer: () => (st.some((v) => v === 1) ? st.map((v) => (v === 1 ? 1 : 0)) : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number; v: number } | undefined;
        if (!r) continue;
        st[r.i] = r.v === 2 ? 1 : 2;
        fixed.add(r.i);
        draw(r.i);
      }
      sums();
    },
    solution(sol) {
      (sol as number[]).forEach((v, i) => {
        const wrong = (v === 1) !== (st[i] === 1);
        st[i] = v ? 1 : 2;
        draw(i);
        if (wrong) boxes[i].classList.add('fix');
      });
      sums();
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- ножички (шикаку)

function shikakuPad(d: ShikakuData, changed: Changed): Pad {
  const N = d.w * d.h;
  const owner = new Array(N).fill(-1);
  const fixedC = new Set<number>();
  const el = h(`<div class="dv-shik" style="--w:${d.w}"></div>`);
  const boxes: HTMLElement[] = [];
  let off = false;
  let from = -1;
  // цвет участка — по номеру клетки-числа
  const tint = (c: number) => `hsl(${(c * 137) % 360} 55% 82%)`;
  const draw = () => {
    for (let i = 0; i < N; i++) {
      const c = owner[i];
      const b = boxes[i];
      b.style.background = c >= 0 ? tint(c) : '';
      const x = i % d.w;
      const y = (i / d.w) | 0;
      const diff = (j: number, ok: boolean) => !ok || owner[j] !== c || c < 0;
      b.style.borderTopWidth = diff(i - d.w, y > 0) ? '2px' : '0';
      b.style.borderLeftWidth = diff(i - 1, x > 0) ? '2px' : '0';
      b.classList.toggle('bad', c >= 0 && [...owner].filter((o) => o === c).length !== d.nums[c]);
      b.classList.toggle('fixed', fixedC.has(c));
    }
  };
  const cellAt = (e: PointerEvent) => {
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-i]') as HTMLElement | null;
    return t && el.contains(t) ? Number(t.dataset.i) : -1;
  };
  const rectCells = (a: number, b: number) => {
    const x0 = Math.min(a % d.w, b % d.w);
    const x1 = Math.max(a % d.w, b % d.w);
    const y0 = Math.min((a / d.w) | 0, (b / d.w) | 0);
    const y1 = Math.max((a / d.w) | 0, (b / d.w) | 0);
    const out: number[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * d.w + x);
    return out;
  };
  const preview = (a: number, b: number) => {
    const cs = new Set(a >= 0 && b >= 0 ? rectCells(a, b) : []);
    boxes.forEach((x, i) => x.classList.toggle('sel', cs.has(i)));
  };
  for (let i = 0; i < N; i++) {
    const b = h(`<div data-i="${i}">${d.nums[i] || ''}</div>`);
    boxes.push(b);
    el.appendChild(b);
  }
  el.addEventListener('pointerdown', (e) => {
    if (off) return;
    e.preventDefault();
    from = cellAt(e);
    if (from >= 0) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* синтетическое событие без захвата — не страшно */
      }
      preview(from, from);
    }
  });
  el.addEventListener('pointercancel', () => {
    from = -1;
    preview(-1, -1);
  });
  el.addEventListener('pointermove', (e) => {
    if (from >= 0) preview(from, cellAt(e));
  });
  el.addEventListener('pointerup', (e) => {
    if (from < 0) return;
    const to = cellAt(e);
    const a = from;
    from = -1;
    preview(-1, -1);
    if (to < 0) return;
    const cs = rectCells(a, to);
    if (a === to && owner[a] >= 0) {
      // нажатие по участку — убрать его
      const c = owner[a];
      if (fixedC.has(c)) return;
      for (let i = 0; i < N; i++) if (owner[i] === c) owner[i] = -1;
    } else {
      const clues = cs.filter((i) => d.nums[i]);
      if (clues.length !== 1) return;
      const c = clues[0];
      if (fixedC.has(c) || cs.some((i) => fixedC.has(owner[i]))) return;
      // старый участок этого числа и пересечённые — снять
      const hit = new Set(cs.map((i) => owner[i]).filter((o) => o >= 0));
      hit.add(c);
      for (let i = 0; i < N; i++) if (hit.has(owner[i])) owner[i] = -1;
      cs.forEach((i) => (owner[i] = c));
    }
    draw();
    changed();
  });
  draw();
  return {
    el,
    answer: () => (owner.every((o) => o >= 0) ? owner.slice() : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { c: number; cells: number[] } | undefined;
        if (!r) continue;
        for (let i = 0; i < N; i++) if (owner[i] === r.c || r.cells.includes(i)) owner[i] = -1;
        r.cells.forEach((i) => (owner[i] = r.c));
        fixedC.add(r.c);
      }
      draw();
    },
    solution(sol) {
      (sol as number[]).forEach((c, i) => (owner[i] = c));
      draw();
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- палатки

function palatkiPad(d: PalatkiData, changed: Changed): Pad {
  const { n } = d;
  const tree = new Set(d.trees);
  const st = new Array(n * n).fill(0); // 1 — палатка, 2 — трава (пометка)
  const fixed = new Set<number>();
  const el = h(`<div class="dv-pal" style="--n:${n + 1}"></div>`);
  const boxes: HTMLElement[] = [];
  const rowEls: HTMLElement[] = [];
  const colEls: HTMLElement[] = [];
  let off = false;
  const draw = () => {
    boxes.forEach((b, i) => {
      if (tree.has(i)) return;
      b.textContent = st[i] === 1 ? '⛺' : st[i] === 2 ? '·' : '';
      b.className = `pc${st[i] === 2 ? ' grass' : ''}${fixed.has(i) ? ' fixed' : ''}`;
    });
    for (let r = 0; r < n; r++) rowEls[r].classList.toggle('ok', st.slice(r * n, r * n + n).filter((v) => v === 1).length === d.rows[r]);
    for (let c = 0; c < n; c++) colEls[c].classList.toggle('ok', Array.from({ length: n }, (_, r) => st[r * n + c]).filter((v) => v === 1).length === d.cols[c]);
  };
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const b = h(`<div class="${tree.has(i) ? 'tree' : 'pc'}">${tree.has(i) ? '🌳' : ''}</div>`);
      if (!tree.has(i))
        b.addEventListener('click', () => {
          if (off || fixed.has(i)) return;
          st[i] = (st[i] + 1) % 3;
          draw();
          changed();
        });
      boxes.push(b);
      el.appendChild(b);
    }
    rowEls.push(el.appendChild(h(`<div class="cnt">${d.rows[r]}</div>`)));
  }
  for (let c = 0; c < n; c++) colEls.push(el.appendChild(h(`<div class="cnt">${d.cols[c]}</div>`)));
  el.appendChild(h(`<div></div>`));
  const wrap = h(`<div class="dv-morboyw"></div>`);
  wrap.append(el, h(`<p class="dv-known small">Нажатие: палатка → трава (пометка) → пусто.</p>`));
  draw();
  return {
    el: wrap,
    answer: () => (st.some((v) => v === 1) ? st.map((v) => (v === 1 ? 1 : 0)) : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number } | undefined;
        if (!r) continue;
        st[r.i] = 1;
        fixed.add(r.i);
      }
      draw();
    },
    solution(sol) {
      (sol as number[]).forEach((v, i) => !tree.has(i) && (st[i] = v ? 1 : 2));
      draw();
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- фонари

function fonariPad(d: FonariData, changed: Changed): Pad {
  const { n } = d;
  const N = n * n;
  const bulb = new Array(N).fill(0);
  const fixed = new Set<number>();
  const el = h(`<div class="dv-fon" style="--n:${n}"></div>`);
  const boxes: HTMLElement[] = [];
  let off = false;
  const seeFrom = (i: number) => {
    const out = [i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let x = (i % n) + dx;
      let y = ((i / n) | 0) + dy;
      while (x >= 0 && y >= 0 && x < n && y < n && d.cells[y * n + x] === -1) {
        out.push(y * n + x);
        x += dx;
        y += dy;
      }
    }
    return out;
  };
  const draw = () => {
    const lit = new Array(N).fill(0);
    bulb.forEach((b, i) => b && seeFrom(i).forEach((j) => lit[j]++));
    boxes.forEach((b, i) => {
      if (d.cells[i] !== -1) {
        const near = [i - n, i + n, i % n ? i - 1 : -1, (i + 1) % n ? i + 1 : -1].filter((j) => j >= 0 && j < N && bulb[j]).length;
        b.classList.toggle('ok', d.cells[i] >= 0 && near === d.cells[i]);
        b.classList.toggle('over', d.cells[i] >= 0 && near > d.cells[i]);
        return;
      }
      b.textContent = bulb[i] ? '💡' : '';
      b.classList.toggle('lit', lit[i] > 0);
      b.classList.toggle('clash', !!bulb[i] && lit[i] > 1);
      b.classList.toggle('fixed', fixed.has(i));
    });
  };
  d.cells.forEach((v, i) => {
    const b = h(`<div class="${v === -1 ? 'fw' : 'fb'}">${v >= 0 ? v : ''}</div>`);
    if (v === -1)
      b.addEventListener('click', () => {
        if (off || fixed.has(i)) return;
        bulb[i] = bulb[i] ? 0 : 1;
        draw();
        changed();
      });
    boxes.push(b);
    el.appendChild(b);
  });
  draw();
  return {
    el,
    answer: () => (bulb.some(Boolean) ? bulb.slice() : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number } | undefined;
        if (!r) continue;
        bulb[r.i] = 1;
        fixed.add(r.i);
      }
      draw();
    },
    solution(sol) {
      (sol as number[]).forEach((v, i) => (bulb[i] = v));
      draw();
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- грядки

function gryadkiPad(d: GryadkiData, changed: Changed): Pad {
  const { n } = d;
  const N = n * n;
  const g = d.given.slice();
  const fixed = new Set(d.given.map((v, i) => (v ? i : -1)).filter((i) => i >= 0));
  const el = h(`<div class="dv-gry" style="--n:${n}"></div>`);
  const boxes: HTMLElement[] = [];
  let off = false;
  const draw = (i: number) => {
    boxes[i].textContent = g[i] ? VEG[g[i] - 1] : '';
    boxes[i].classList.toggle('given', fixed.has(i));
  };
  for (let i = 0; i < N; i++) {
    const r = (i / n) | 0;
    const c = i % n;
    const k = d.reg[i];
    const b = [r === 0 || d.reg[i - n] !== k, c === n - 1 || d.reg[i + 1] !== k, r === n - 1 || d.reg[i + n] !== k, c === 0 || d.reg[i - 1] !== k];
    const box = h(`<div class="gc" style="border-width:${b.map((x) => (x ? '3px' : '1px')).join(' ')};background:hsl(${(k * 67) % 360} 40% 90%)"></div>`);
    box.addEventListener('click', () => {
      if (off || fixed.has(i)) return;
      g[i] = (g[i] + 1) % (n + 1);
      draw(i);
      changed();
    });
    boxes.push(box);
    el.appendChild(box);
    draw(i);
  }
  const wrap = h(`<div class="dv-morboyw"><p class="dv-known">Овощи: ${VEG.slice(0, n).map((v, i) => `${v} ${VEG_NAMES[i]}`).join(', ')}. Нажатие по клетке — следующий овощ.</p></div>`);
  wrap.appendChild(el);
  return {
    el: wrap,
    answer: () => (g.every(Boolean) ? g.slice() : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number; v: number } | undefined;
        if (!r) continue;
        g[r.i] = r.v;
        fixed.add(r.i);
        draw(r.i);
      }
    },
    solution(sol) {
      (sol as number[]).forEach((v, i) => {
        if (g[i] !== v) boxes[i].classList.add('shown');
        g[i] = v;
        draw(i);
      });
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- картинка (нонограмма)

function kartinkaPad(d: KartinkaData, changed: Changed): Pad {
  const { w, h: hh } = d;
  const st = new Array(w * hh).fill(0); // 1 — закрашено, 2 — крестик
  const fixed = new Set<number>();
  d.open.forEach(([i, v]) => {
    st[i] = v ? 1 : 2;
    fixed.add(i);
  });
  const maxR = Math.max(...d.rows.map((r) => r.length));
  const maxC = Math.max(...d.cols.map((c) => c.length));
  const el = h(`<div class="dv-kart" style="--w:${w};--u:min(34px, calc((100vw - 110px) / ${w + 2}))"></div>`);
  el.appendChild(h(`<div class="corner"></div>`));
  d.cols.forEach((c) => el.appendChild(h(`<div class="ch" style="height:calc(${maxC} * 0.95em)">${c.map((x) => `<span>${x}</span>`).join('')}</div>`)));
  const boxes: HTMLElement[] = [];
  let off = false;
  let paint = -1;
  const draw = (i: number) => {
    boxes[i].className = `kc${st[i] === 1 ? ' on' : st[i] === 2 ? ' x' : ''}${fixed.has(i) ? ' fixed' : ''}${(i % w) % 5 === 4 && i % w !== w - 1 ? ' br' : ''}${((i / w) | 0) % 5 === 4 && ((i / w) | 0) !== hh - 1 ? ' bb' : ''}`;
  };
  for (let r = 0; r < hh; r++) {
    el.appendChild(h(`<div class="rh" style="min-width:calc(${maxR} * 0.75em)">${d.rows[r].map((x) => `<span>${x}</span>`).join(' ')}</div>`));
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const b = h(`<div data-i="${i}"></div>`);
      boxes.push(b);
      el.appendChild(b);
      draw(i);
    }
  }
  // нажатие — по кругу: закрасить → крестик → пусто; протягивание красит тем же
  const apply = (i: number) => {
    if (fixed.has(i) || st[i] === paint) return;
    st[i] = paint;
    draw(i);
    changed();
  };
  const at = (e: PointerEvent) => {
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-i]') as HTMLElement | null;
    return t && el.contains(t) ? Number(t.dataset.i) : -1;
  };
  el.addEventListener('pointerdown', (e) => {
    const i = at(e);
    if (off || i < 0 || fixed.has(i)) return;
    e.preventDefault();
    paint = (st[i] + 1) % 3;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* синтетическое */
    }
    apply(i);
  });
  el.addEventListener('pointermove', (e) => {
    if (paint < 0) return;
    const i = at(e);
    if (i >= 0) apply(i);
  });
  const stop = () => (paint = -1);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  return {
    el,
    answer: () => (st.some((v) => v === 1) ? st.map((v) => (v === 1 ? 1 : 0)) : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number; v: number } | undefined;
        if (!r) continue;
        st[r.i] = r.v ? 1 : 2;
        fixed.add(r.i);
        draw(r.i);
      }
    },
    solution(sol) {
      (sol as number[]).forEach((v, i) => {
        st[i] = v ? 1 : 2;
        draw(i);
      });
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- найди одиночку

function odinPad(d: OdinData, changed: Changed): Pad {
  let pick = -1;
  let off = false;
  const el = h(`<div class="dv-odin" style="--c:${d.cols}"></div>`);
  const boxes = d.cells.map((x, i) => {
    const b = h(`<button class="oc" type="button">${x}</button>`);
    b.addEventListener('click', () => {
      if (off || b.classList.contains('gone')) return;
      pick = pick === i ? -1 : i;
      boxes.forEach((y, j) => y.classList.toggle('pick', j === pick));
      changed();
    });
    el.appendChild(b);
    return b;
  });
  return {
    el,
    answer: () => (pick >= 0 ? pick : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { icon: string } | undefined;
        if (!r) continue;
        boxes.forEach((b, i) => d.cells[i] === r.icon && b.classList.add('gone'));
      }
    },
    solution(sol) {
      boxes[sol as number].classList.add('right');
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- матрица

function figSvg(f: Fig): string {
  const one = (cx: number, cy: number, s: number) => {
    const c = COLORS[f.color];
    switch (f.shape) {
      case 0:
        return `<circle cx="${cx}" cy="${cy}" r="${s}" fill="${c}"/>`;
      case 1:
        return `<rect x="${cx - s}" y="${cy - s}" width="${2 * s}" height="${2 * s}" fill="${c}"/>`;
      case 2:
        return `<polygon points="${cx},${cy - s * 1.1} ${cx + s * 1.1},${cy + s * 0.9} ${cx - s * 1.1},${cy + s * 0.9}" fill="${c}"/>`;
      default:
        return `<polygon points="${cx},${cy - s * 1.2} ${cx + s},${cy} ${cx},${cy + s * 1.2} ${cx - s},${cy}" fill="${c}"/>`;
    }
  };
  const n = f.count + 1;
  const pos = n === 1 ? [[30, 30]] : n === 2 ? [[18, 30], [42, 30]] : [[30, 16], [17, 41], [43, 41]];
  return `<svg viewBox="0 0 60 60">${pos.map(([x, y]) => one(x, y, n === 1 ? 14 : 10)).join('')}</svg>`;
}

function matrixPad(d: MatrixData, changed: Changed): Pad {
  let pick = -1;
  let off = false;
  const el = h(`<div class="dv-matrix"><div class="grid">${d.cells.map((f) => `<div class="mc">${figSvg(f)}</div>`).join('')}<div class="mc q">?</div></div>
    <p class="dv-known">Что встанет на место знака вопроса?</p><div class="opts"></div></div>`);
  const opts = el.querySelector('.opts') as HTMLElement;
  const btns = d.options.map((f, i) => {
    const b = h(`<button type="button" class="mc opt">${figSvg(f)}</button>`);
    b.addEventListener('click', () => {
      if (off || b.classList.contains('gone')) return;
      pick = i;
      btns.forEach((x, j) => x.classList.toggle('pick', j === i));
      changed();
    });
    opts.appendChild(b);
    return b;
  });
  return {
    el,
    answer: () => (pick >= 0 ? pick : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { not: number } | undefined;
        if (r?.not != null) btns[r.not].classList.add('gone');
      }
    },
    solution(sol) {
      btns[sol as number].classList.add('right');
      (el.querySelector('.q') as HTMLElement).innerHTML = figSvg(d.options[sol as number]);
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- кружки (Венн)

function vennPad(d: VennData, changed: Changed): Pad {
  const three = d.sets.length === 3;
  const circles = three
    ? `<circle cx="125" cy="72" r="52"/><circle cx="185" cy="72" r="52"/><circle cx="155" cy="120" r="52"/>
       <text x="4" y="16">${esc(d.sets[0])}</text><text x="306" y="16" text-anchor="end">${esc(d.sets[1])}</text><text x="155" y="190" text-anchor="middle">${esc(d.sets[2])}</text>`
    : `<circle cx="125" cy="85" r="62"/><circle cx="185" cy="85" r="62"/>
       <text x="4" y="16">${esc(d.sets[0])}</text><text x="306" y="16" text-anchor="end">${esc(d.sets[1])}</text>`;
  const body = h(`<div class="dv-venn"><ul>${d.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    <svg viewBox="0 0 310 ${three ? 196 : 160}">${circles}</svg><p><b>${esc(d.ask)}</b></p><p class="dv-known small">Кружки нарисованы для подсчёта — впиши числа в голове или на бумажке.</p></div>`);
  return numPad(body, 'Ответ:', changed);
}

// ---------------------------------------------------------------- шестерёнки

function gearSvg(cx: number, cy: number, r: number, teeth: number, cls: string): string {
  const k = Math.min(teeth, 24);
  let d = '';
  for (let i = 0; i < k * 2; i++) {
    const a = (i * Math.PI) / k;
    const rr = i % 2 ? r : r + 5;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`;
  }
  return `<g class="${cls}"><path d="${d}Z"/><text x="${cx}" y="${cy + 5}">${teeth}</text></g>`;
}

function gearsPad(d: GearsData, changed: Changed): Pad {
  // раскладка в ряд: радиус ~ зубьям; сцепленные — вплотную, на цепи/ремне — с промежутком
  const R = d.teeth.map((t) => 12 + t * 0.9);
  const xs: number[] = [];
  let x = R[0] + 8;
  d.teeth.forEach((_, i) => {
    if (i) x += R[i - 1] + R[i] + (d.links[i - 1] === 'mesh' ? 4 : 34);
    xs.push(x);
  });
  const W = x + R[R.length - 1] + 10;
  const H = Math.max(...R) * 2 + 40;
  const cy = H / 2 - 6;
  let links = '';
  d.links.forEach((l, i) => {
    if (l === 'mesh') return;
    const [a, b] = [xs[i], xs[i + 1]];
    if (l === 'chain') links += `<line class="belt" x1="${a}" y1="${cy - R[i]}" x2="${b}" y2="${cy - R[i + 1]}"/><line class="belt" x1="${a}" y1="${cy + R[i]}" x2="${b}" y2="${cy + R[i + 1]}"/>`;
    else links += `<line class="belt" x1="${a}" y1="${cy - R[i]}" x2="${b}" y2="${cy + R[i + 1]}"/><line class="belt" x1="${a}" y1="${cy + R[i]}" x2="${b}" y2="${cy - R[i + 1]}"/>`;
  });
  const gears = d.teeth.map((t, i) => gearSvg(xs[i], cy, R[i], t, i === 0 ? 'g first' : i === d.ask ? 'g ask' : 'g')).join('');
  const marks = `<text class="lbl" x="${xs[0]}" y="${H - 4}">↻ ${d.turns}</text><text class="lbl ask" x="${xs[d.ask]}" y="${H - 4}">?</text>`;
  const el = h(`<div class="dv-gears"><svg viewBox="0 0 ${W} ${H}">${links}${gears}${marks}</svg>
    <p class="dv-known">Числа — зубья. Сцепленные зубьями крутятся в разные стороны; на цепи — в одну сторону; на перекрещённом ремне — в разные.
    Первая (зелёная) делает <b>${d.turns}</b> ${d.turns === 1 ? 'оборот' : d.turns < 5 ? 'оборота' : 'оборотов'} по часовой стрелке. Что сделает отмеченная «?»?</p></div>`);
  const { el: ask, inp } = numAnswer('Оборотов:', changed);
  const dir = h(`<div class="dv-dir"><button type="button" class="btn small" data-cw="1">↻ по часовой</button><button type="button" class="btn small" data-cw="0">↺ против</button></div>`);
  let cw: boolean | null = null;
  const btns = [...dir.querySelectorAll('button')] as HTMLButtonElement[];
  const setDir = (v: boolean | null) => {
    cw = v;
    btns.forEach((b) => b.classList.toggle('on', v != null && (b.dataset.cw === '1') === v));
  };
  btns.forEach((b) =>
    b.addEventListener('click', () => {
      setDir(b.dataset.cw === '1');
      changed();
    }),
  );
  el.append(ask, dir);
  return {
    el,
    answer: () => (inp.value && cw != null ? { turns: Number(inp.value), cw } : null),
    hints() {},
    solution(sol) {
      const s = sol as GearsAns;
      if (Number(inp.value) !== s.turns) {
        inp.value = String(s.turns);
        inp.classList.add('shown');
      }
      setDir(s.cw);
    },
    lock() {
      inp.readOnly = true;
      btns.forEach((b) => (b.disabled = true));
    },
  };
}

// ---------------------------------------------------------------- турнир

function turnirPad(d: TurnirData, changed: Changed): Pad {
  const t = (i: number) => esc(d.teams[i]);
  const res = (r: number, i: number, j: number) => (r === 0 ? `${t(i)} — ${t(j)}: ничья` : `${t(r === 1 ? i : j)} обыграл ${t(r === 1 ? j : i)}`);
  const body = h(`<div class="dv-turnir">
    <p>Турнир по футболу двор на двор: каждая команда сыграла с каждой по разу. За победу — 3 очка, за ничью — 1, за поражение — 0.</p>
    <table class="dv-ttab"><tr><th>Команда</th><th>Очки</th></tr>${d.teams.map((_, i) => `<tr><td>${t(i)}</td><td>${d.points[i]}</td></tr>`).join('')}</table>
    ${d.known.length ? `<p>Известно:</p><ul>${d.known.map(([i, j, r]) => `<li>${res(r, i, j)}</li>`).join('')}</ul>` : ''}
    <p><b>${d.ask ? `Как сыграли ${t(d.ask[0])} и ${t(d.ask[1])}?` : 'Сколько матчей закончились вничью?'}</b></p></div>`);
  if (!d.ask) return numPad(body, 'Ничьих:', changed);
  const [a, b] = d.ask;
  let pick: number | null = null;
  const row = h(`<div class="dv-dir"><button type="button" class="btn small" data-r="1">победа ${t(a)}</button><button type="button" class="btn small" data-r="0">ничья</button><button type="button" class="btn small" data-r="-1">победа ${t(b)}</button></div>`);
  const btns = [...row.querySelectorAll('button')] as HTMLButtonElement[];
  const set = (v: number | null) => {
    pick = v;
    btns.forEach((x) => x.classList.toggle('on', v != null && Number(x.dataset.r) === v));
  };
  btns.forEach((x) =>
    x.addEventListener('click', () => {
      set(Number(x.dataset.r));
      changed();
    }),
  );
  const el = h(`<div class="dv-chain"></div>`);
  el.append(body, row);
  return {
    el,
    answer: () => pick,
    hints() {},
    solution(sol) {
      set(sol as number);
    },
    lock() {
      btns.forEach((x) => (x.disabled = true));
    },
  };
}

// ---------------------------------------------------------------- земелька

function zemPad(d: ZemData, changed: Changed): Pad {
  const U = 30;
  let grid = '';
  for (let x = 0; x <= d.w; x++) grid += `M${x * U} 0V${d.h * U}`;
  for (let y = 0; y <= d.h; y++) grid += `M0 ${y * U}H${d.w * U}`;
  const poly = d.pts.map(([x, y]) => `${x * U},${y * U}`).join(' ');
  const body = h(`<div class="dv-zem"><svg viewBox="-4 -4 ${d.w * U + 8} ${d.h * U + 8}"><path class="gr" d="${grid}"/><polygon points="${poly}"/>${d.pts
    .map(([x, y]) => `<circle cx="${x * U}" cy="${y * U}" r="3.5"/>`)
    .join('')}</svg><p><b>Сколько клеток земли в участке?</b> Половинки клеток тоже считаются: ответ может быть с «,5».</p></div>`);
  const el = h(`<div class="dv-chain"></div>`);
  el.appendChild(body);
  const ask = h(`<label class="dv-cask">Площадь: <input class="cell wide" inputmode="decimal" maxlength="5" autocomplete="off" aria-label="площадь"> клеток</label>`);
  const inp = ask.querySelector('input') as HTMLInputElement;
  inp.oninput = () => {
    inp.value = inp.value.replace(/[^\d,.]/g, '').replace('.', ',').slice(0, 5);
    changed();
  };
  el.appendChild(ask);
  return {
    el,
    answer: () => (inp.value ? inp.value : null),
    hints() {},
    solution(sol) {
      const s = String(sol).replace('.', ',');
      if (inp.value !== s) {
        inp.value = s;
        inp.classList.add('shown');
      }
    },
    lock() {
      inp.readOnly = true;
    },
  };
}

// ---------------------------------------------------------------- по кратным

function kratPad(d: KratData, changed: Changed): Pad {
  const { n } = d;
  const el = h(`<div class="dv-krat" style="--n:${n}"></div>`);
  let path = [d.start];
  let fixed = 1;
  let off = false;
  const boxes: HTMLElement[] = [];
  const adj = (a: number, b: number) => Math.abs((a % n) - (b % n)) + Math.abs(((a / n) | 0) - ((b / n) | 0)) === 1;
  const draw = () => {
    const at = new Map(path.map((c, i) => [c, i]));
    boxes.forEach((b, i) => {
      b.classList.toggle('on', at.has(i));
      b.classList.toggle('head', i === path[path.length - 1]);
      b.classList.toggle('fixed', (at.get(i) ?? 99) < fixed);
    });
  };
  d.nums.forEach((v, i) => {
    const b = h(`<div class="kr${i === d.start ? ' st' : i === d.end ? ' fin' : ''}">${v}</div>`);
    b.addEventListener('click', () => {
      if (off) return;
      const at = path.indexOf(i);
      if (at >= 0) path = path.slice(0, Math.max(at + 1, fixed));
      else if (adj(path[path.length - 1], i)) path.push(i);
      else return;
      draw();
      changed();
    });
    boxes.push(b);
    el.appendChild(b);
  });
  draw();
  const wrap = h(`<div class="dv-morboyw"><p class="dv-known">Прыгать можно только на числа, которые делятся на <b>${d.k}</b>. Начало — зелёная клетка, конец — красная. Нажимай клетки по порядку.</p></div>`);
  wrap.appendChild(el);
  return {
    el: wrap,
    answer: () => (path[path.length - 1] === d.end ? path.slice() : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { path: number[] } | undefined;
        if (!r || r.path.length <= fixed) continue;
        path = r.path.slice();
        fixed = r.path.length;
      }
      draw();
    },
    solution(sol) {
      path = (sol as number[]).slice();
      draw();
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- зеркало

function mirrorPad(d: MirrorData, changed: Changed): Pad {
  const { n } = d;
  const g: number[] = d.given.map((v) => (v === 1 ? 1 : 0));
  const el = h(`<div class="dv-mir ax-${d.axis}" style="--n:${n}"></div>`);
  const boxes: HTMLElement[] = [];
  let off = false;
  const draw = (i: number) => boxes[i].classList.toggle('on', !!g[i]);
  d.given.forEach((v, i) => {
    const b = h(`<div class="${v === -1 ? 'mm' : 'mg'}"></div>`);
    if (v === -1)
      b.addEventListener('click', () => {
        if (off) return;
        g[i] = g[i] ? 0 : 1;
        draw(i);
        changed();
      });
    boxes.push(b);
    el.appendChild(b);
    draw(i);
  });
  const what = d.axis === 'v' ? 'Зеркало стоит посередине — дорисуй правую половину.' : d.axis === 'd' ? 'Зеркало — по диагонали из левого верхнего угла. Дорисуй верхний правый треугольник.' : 'Снежинка сложена вчетверо: дорисуй остальные три четверти — зеркально по обеим осям.';
  const wrap = h(`<div class="dv-morboyw"><p class="dv-known">${what}</p></div>`);
  wrap.appendChild(el);
  return {
    el: wrap,
    answer: () => g.slice(),
    hints() {},
    solution(sol) {
      (sol as number[]).forEach((v, i) => {
        if (d.given[i] === -1 && g[i] !== v) boxes[i].classList.add('fix');
        g[i] = v;
        draw(i);
      });
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- раскраска

const PAINT = ['#e9e4d6', '#d9534f', '#3e7cc9', '#f0c419', '#4caf50'];

function raskPad(d: RaskData, changed: Changed): Pad {
  const nReg = Math.max(...d.reg) + 1;
  const col = new Array(nReg).fill(0);
  const fixed = new Set<number>();
  d.given.forEach(([r, c]) => {
    col[r] = c;
    fixed.add(r);
  });
  const el = h(`<div class="dv-rask" style="--w:${d.w}"></div>`);
  const boxes: HTMLElement[] = [];
  let off = false;
  const draw = () =>
    boxes.forEach((b, i) => {
      const r = d.reg[i];
      b.style.background = PAINT[col[r]];
      b.classList.toggle('fixed', fixed.has(r));
    });
  d.reg.forEach((r, i) => {
    const x = i % d.w;
    const y = (i / d.w) | 0;
    const bw = [y === 0 || d.reg[i - d.w] !== r, x === d.w - 1 || d.reg[i + 1] !== r, y === d.h - 1 || d.reg[i + d.w] !== r, x === 0 || d.reg[i - 1] !== r];
    const b = h(`<div style="border-width:${bw.map((v) => (v ? '2px' : '0')).join(' ')}"></div>`);
    b.addEventListener('click', () => {
      if (off || fixed.has(r)) return;
      col[r] = (col[r] + 1) % (d.colors + 1);
      draw();
      changed();
    });
    boxes.push(b);
    el.appendChild(b);
  });
  draw();
  const wrap = h(`<div class="dv-morboyw"><p class="dv-known">Цветов: ${PAINT.slice(1, d.colors + 1).map((c) => `<i class="sw" style="background:${c}"></i>`).join(' ')}. Нажатие по участку — следующий цвет. Соседние участки (по стороне) — разного цвета.</p></div>`);
  wrap.appendChild(el);
  return {
    el: wrap,
    answer: () => (col.every(Boolean) ? col.slice() : null),
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { r: number; c: number } | undefined;
        if (!r) continue;
        col[r.r] = r.c;
        fixed.add(r.r);
      }
      draw();
    },
    solution(sol) {
      (sol as number[]).forEach((c, r) => (col[r] = c));
      draw();
    },
    lock() {
      off = true;
    },
  };
}

// ---------------------------------------------------------------- какуро

function kakuroPad(d: KakuroData, changed: Changed): Pad {
  const el = h(`<div class="dv-kak" data-grid="${d.w}" style="--w:${d.w}"></div>`);
  const inputs: (HTMLInputElement | null)[] = [];
  d.cells.forEach((v, i) => {
    if (v === -1) {
      const s = d.sums[i];
      el.appendChild(h(`<div class="kw">${s ? `${s[1] ? `<i class="dn">${s[1]}</i>` : ''}${s[0] ? `<i class="rt">${s[0]}</i>` : ''}` : ''}</div>`));
      inputs.push(null);
    } else if (v > 0) {
      el.appendChild(h(`<div class="kg">${v}</div>`));
      inputs.push(null);
    } else {
      const inp = digitCell(9, changed);
      el.appendChild(inp);
      inputs.push(inp);
    }
  });
  return {
    el,
    answer() {
      const out = d.cells.map((v, i) => (v === -1 ? 0 : v > 0 ? v : Number(inputs[i]!.value || 0)));
      return d.cells.some((v, i) => v === 0 && !out[i]) ? null : out;
    },
    hints(hs) {
      for (const hnt of hs) {
        const r = hnt.reveal as { i: number; v: number } | undefined;
        const inp = r && inputs[r.i];
        if (inp) setCell(inp, r.v, 'fixed');
      }
    },
    solution(sol) {
      (sol as number[]).forEach((v, i) => {
        const inp = inputs[i];
        if (inp && Number(inp.value) !== v) setCell(inp, v, 'shown');
      });
    },
    lock() {
      inputs.forEach((i) => i && (i.readOnly = true));
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
    case 'bulls':
      return bullsPad(data as BullsData, changed);
    case 'stopki':
      return stopkiPad(data as StopkiData, changed);
    case 'kenken':
      return kenkenPad(data as KenkenData, changed);
    case 'chain':
      return chainPad(data as ChainData, changed);
    case 'clock':
      return clockPad(data as ClockData, changed);
    case 'shop':
      return shopPad(data as ShopData, changed);
    case 'ostatki':
      return ostatkiPad(data as OstatkiData, changed);
    case 'zadachka':
      return zadachkaPad(data as ZadachkaData, changed);
    case 'labirint':
      return labPad(data as LabData, changed);
    case 'strelki':
      return strelkiPad(data as StrelkiData, changed);
    case 'saper':
      return saperPad(data as SaperData, changed);
    case 'morboy':
      return morboyPad(data as MorboyData, changed);
    case 'shikaku':
      return shikakuPad(data as ShikakuData, changed);
    case 'palatki':
      return palatkiPad(data as PalatkiData, changed);
    case 'fonari':
      return fonariPad(data as FonariData, changed);
    case 'gryadki':
      return gryadkiPad(data as GryadkiData, changed);
    case 'kartinka':
      return kartinkaPad(data as KartinkaData, changed);
    case 'odin':
      return odinPad(data as OdinData, changed);
    case 'matrix':
      return matrixPad(data as MatrixData, changed);
    case 'venn':
      return vennPad(data as VennData, changed);
    case 'gears':
      return gearsPad(data as GearsData, changed);
    case 'turnir':
      return turnirPad(data as TurnirData, changed);
    case 'zem':
      return zemPad(data as ZemData, changed);
    case 'krat':
      return kratPad(data as KratData, changed);
    case 'mirror':
      return mirrorPad(data as MirrorData, changed);
    case 'rask':
      return raskPad(data as RaskData, changed);
    case 'kakuro':
      return kakuroPad(data as KakuroData, changed);
  }
  return { el: h(`<div>?</div>`), answer: () => null, hints() {}, solution() {}, lock() {} };
}
