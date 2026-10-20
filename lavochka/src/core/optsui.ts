/* Выбор вариантов правил: кнопки пресетов и поля вариантов. Общий для экрана игры и лобби комнаты. */
import type { GameDef, OptionDef, Options } from './types';
import { esc, h } from './util';

/** Какой пресет совпадает с вариантами (null — свои правила). Подходят несколько — самый подробный:
 * «Подкидной» молчит про команды, поэтому «2 на 2» подходит и под него. */
export function matchPreset(def: GameDef, options: Options): string | null {
  let best: { id: string; n: number } | null = null;
  for (const p of def.presets || []) {
    const keys = Object.entries(p.options);
    if (keys.every(([k, v]) => options[k] === v) && (!best || keys.length > best.n)) best = { id: p.id, n: keys.length };
  }
  return best?.id ?? null;
}

/** Числа игроков, допустимые при этих вариантах (игра может сузить список: «Шайба» — 2, 4, 6). */
export function allowedCounts(def: GameDef, options: Options): number[] {
  const list = (def.countsFor?.(options) ?? []).filter((n) => n >= def.players.min && n <= def.players.max);
  const uniq = [...new Set(list)].sort((a, b) => a - b);
  if (uniq.length) return uniq;
  const out: number[] = [];
  for (let n = def.players.min; n <= def.players.max; n++) out.push(n);
  return out;
}

/** Варианты строкой для гостя: «Подкидной» или «свои правила: …». */
export function optionsSummary(def: GameDef, options: Options): string {
  const p = def.presets?.find((x) => x.id === matchPreset(def, options));
  const parts: string[] = [];
  for (const o of def.options || []) {
    if (o.showIf && !o.showIf(options)) continue;
    const v = options[o.key];
    if (o.type === 'toggle') {
      if (v === true && v !== o.default) parts.push(o.label.toLowerCase());
    } else if (v !== o.default) {
      const ch = o.choices?.find((c) => c.value === v);
      parts.push(`${o.label.toLowerCase()}: ${ch ? ch.label : String(v)}`);
    }
  }
  if (p) return p.label;
  return parts.length ? 'свои правила: ' + parts.join(', ') : 'обычные правила';
}

/**
 * Пресеты в presetsBox, поля — в optsBox. Варианты меняются на месте в options; onChange — после каждой смены.
 * render() — перерисовать (варианты сменили снаружи).
 */
export function optionsEditor(def: GameDef, options: Options, presetsBox: HTMLElement, optsBox: HTMLElement, onChange: () => void) {
  presetsBox.replaceChildren();
  // что задаёт хоть один пресет, а этот молчит, — к обычному значению: иначе с «2 на 2» на «Подкидной» команды оставались
  const managed = new Set((def.presets || []).flatMap((p) => Object.keys(p.options)));
  const defaults = new Map((def.options || []).map((o) => [o.key, o.default]));
  for (const p of def.presets || []) {
    const b = h<HTMLButtonElement>(`<button class="preset" data-id="${p.id}" title="${esc(p.hint || '')}">${esc(p.label)}</button>`);
    b.onclick = () => {
      for (const k of managed) if (!(k in p.options) && defaults.has(k)) options[k] = defaults.get(k)!;
      Object.assign(options, p.options);
      render();
      onChange();
    };
    presetsBox.appendChild(b);
  }

  const set = (key: string, value: string | number | boolean) => {
    options[key] = value;
    render();
    onChange();
  };

  function control(o: OptionDef): HTMLElement {
    const v = options[o.key];
    let ctl: HTMLElement;
    if (o.type === 'toggle') {
      ctl = h(`<label class="opt opt-toggle"><input type="checkbox"> <span>${esc(o.label)}</span></label>`);
      const i = ctl.querySelector('input') as HTMLInputElement;
      i.checked = !!v;
      i.onchange = () => set(o.key, i.checked);
    } else if (o.type === 'select') {
      ctl = h(`<label class="opt"><span>${esc(o.label)}</span><select>${(o.choices || []).map((c) => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join('')}</select></label>`);
      const sel = ctl.querySelector('select') as HTMLSelectElement;
      sel.value = String(v);
      sel.onchange = () => {
        const ch = (o.choices || []).find((c) => String(c.value) === sel.value);
        set(o.key, ch ? ch.value : sel.value);
      };
    } else {
      ctl = h(`<label class="opt"><span>${esc(o.label)}</span><input type="number" min="${o.min ?? ''}" max="${o.max ?? ''}" step="${o.step ?? 1}"></label>`);
      const i = ctl.querySelector('input') as HTMLInputElement;
      i.value = String(v);
      i.onchange = () => set(o.key, Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, +i.value || 0)));
    }
    if (o.hint) ctl.appendChild(h(`<small class="opt-hint">${esc(o.hint)}</small>`));
    return ctl;
  }

  function render() {
    const cur = matchPreset(def, options);
    presetsBox.querySelectorAll<HTMLButtonElement>('.preset').forEach((b) => b.classList.toggle('on', b.dataset.id === cur));
    optsBox.replaceChildren();
    for (const o of def.options || []) if (!o.showIf || o.showIf(options)) optsBox.appendChild(control(o));
  }

  render();
  return { render };
}
