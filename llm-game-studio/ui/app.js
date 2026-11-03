'use strict';
// LLM Game Studio — интерфейс. Без сборки и библиотек: состояние с сервера + поток событий (SSE).

const S = { state: null, hw: null, models: [], runs: new Map(), detail: null, selRun: null, selStep: null,
  plan: null, kind: 'all', picks: new Set(), llmMode: null, llmSel: null, purpose: 'code', engines: null };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gb = (b) => b >= 2 ** 30 ? (b / 2 ** 30).toFixed(1) + ' ГБ' : b >= 2 ** 20 ? (b / 2 ** 20).toFixed(0) + ' МБ' : (b / 1024).toFixed(0) + ' КБ';
const dur = (s) => s == null ? '—' : s < 60 ? `${Math.round(s)} с` : s < 3600 ? `${Math.floor(s / 60)} мин ${Math.round(s % 60)} с` : `${Math.floor(s / 3600)} ч ${Math.round((s % 3600) / 60)} мин`;
const fileUrl = (p) => '/api/file?path=' + encodeURIComponent(p);
const STATUS = { pending: 'ждёт', running: 'идёт', waiting: 'ждёт ресурс', approval: 'ждёт решения', done: 'готово', error: 'ошибка',
  skipped: 'пропущен', cancelled: 'отменён', queued: 'в очереди', partial: 'частично', interrupted: 'прерван', unpacking: 'распаковка' };
const STAG = { done: 'ok', error: 'bad', running: 'acc', approval: 'info', partial: 'warn', interrupted: 'warn', unpacking: 'acc' };
const tag = (st) => `<span class="tag ${STAG[st] || ''}">${esc(STATUS[st] || st)}</span>`;

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ct = r.headers.get('Content-Type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(data.error || data || r.statusText);
  return data;
}
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), bad ? 7000 : 3500);
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); console.error(e); } };
const store = { get(k, d) { try { const v = localStorage.getItem('lgs.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lgs.' + k, JSON.stringify(v)); } catch { /* приватный режим */ } } };

// ---------- навигация ----------
function show(tab) {
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  $$('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + tab));
  store.set('tab', tab);
  if (tab === 'hw' && !S.hw) loadHw();
  if (tab === 'models') loadModels();
  if (tab === 'services') { loadEngines(); loadLog(); }
  if (tab === 'format' && !$('#format-doc').innerHTML) loadFormat();
  if (tab === 'settings') renderSettings();
}
$('#nav').addEventListener('click', (e) => { const a = e.target.closest('a[data-tab]'); if (a) show(a.dataset.tab); });

// ---------- живое железо ----------
function gpuBlock(g, compact) {
  const used = g.vram_gb - g.free_gb, pct = Math.min(100, (used / g.vram_gb) * 100);
  return `<div class="${compact ? 'g' : 'gpu'}">
    <div><b>[${g.index}] ${esc(g.name)}</b> <span class="muted">${g.vram_gb} ГБ</span></div>
    <div class="muted">${compact ? '' : `${Math.round(g.util)} % · ${Math.round(g.temp)}° · `}${used.toFixed(1)} / ${g.vram_gb} ГБ</div>
    <div class="meter ${pct > 92 ? 'bad' : ''}"><span style="width:${pct}%"></span></div></div>`;
}
function renderLive(hw) {
  if (!hw) return;
  const ram = hw.ram || {};
  const ramPct = ram.total_gb ? ((ram.total_gb - ram.free_gb) / ram.total_gb) * 100 : 0;
  const ramBlock = (c) => `<div class="${c ? 'g' : 'gpu'}"><div><b>Оперативная память</b></div><div class="muted">${(ram.total_gb - ram.free_gb).toFixed(1)} / ${ram.total_gb} ГБ</div>
    <div class="meter ${ramPct > 92 ? 'bad' : ''}"><span style="width:${ramPct}%"></span></div></div>`;
  $('#side-gpus').innerHTML = (hw.gpus || []).map((g) => gpuBlock(g, true)).join('') + ramBlock(true);
  $('#ov-gpus').innerHTML = ((hw.gpus || []).map((g) => gpuBlock(g)).join('') || '<p class="muted">Видеокарт NVIDIA не найдено — модели пойдут на процессоре.</p>') + ramBlock(false);
}

// ---------- сервисы ----------
function svcCard(s, big) {
  const st = { running: 'ok', external: 'info', starting: 'acc', error: 'bad' }[s.state] || '';
  const name = { running: 'работает', external: 'внешний (не студии)', starting: 'запускается', stopped: 'остановлен', error: 'ошибка' }[s.state] || s.state;
  const btns = s.state === 'running' || s.state === 'starting' ? `<button class="btn small" data-svc-stop="${s.name}">Остановить</button>`
    : s.state === 'external' ? `<button class="btn small danger" data-svc-kill="${s.name}">Остановить чужой…</button>`
      : `<button class="btn small" data-svc-start="${s.name}" ${s.available ? 'disabled' : ''}>Запустить</button>`;
  const prof = s.profile ? `<div class="small muted">${esc(s.profile.title)} ${esc(s.profile.quant)} · контекст ${s.profile.ctx}</div>` : '';
  if (!big) return `<div class="row" style="padding:6px 0"><b class="grow">${esc(s.title)}</b><span class="tag ${st}">${name}</span>${btns}</div>${prof}`;
  return `<div class="card"><div class="row"><b class="grow">${esc(s.title)}</b><span class="tag ${st}">${name}</span></div>
    <div class="small muted">порт ${s.port} · карты ${s.gpus.length ? s.gpus.join(', ') : '—'}${s.pid ? ' · pid ' + s.pid : ''}</div>${prof}
    ${s.available ? `<div class="small" style="color:var(--warn)">${esc(s.available)}</div>` : ''}
    ${s.error ? `<div class="small" style="color:var(--bad)">${esc(s.error)}</div>` : ''}
    <div class="row">${btns}<button class="btn small ghost" data-svc-log="${s.name}">Журнал</button></div></div>`;
}
function renderServices() {
  const list = S.state?.services || [];
  $('#ov-services').innerHTML = list.map((s) => svcCard(s, false)).join('');
  $('#services').innerHTML = list.map((s) => svcCard(s, true)).join('');
  const sel = $('#log-svc');
  if (!sel.options.length) sel.innerHTML = list.map((s) => `<option value="${s.name}">${esc(s.title)}</option>`).join('');
}
document.addEventListener('click', guard(async (e) => {
  const t = e.target.closest('[data-svc-start],[data-svc-stop],[data-svc-kill],[data-svc-log]');
  if (!t) return;
  if (t.dataset.svcStart) { t.disabled = true; await api('/api/services/start', { name: t.dataset.svcStart }); toast('Запускаю…'); }
  if (t.dataset.svcStop) await api('/api/services/stop', { name: t.dataset.svcStop });
  if (t.dataset.svcKill && confirm('Этот сервер запущен не студией. Остановить процесс на его порту?')) await api('/api/services/stop', { name: t.dataset.svcKill, force: true });
  if (t.dataset.svcLog) { show('services'); $('#log-svc').value = t.dataset.svcLog; loadLog(); }
}));
const loadLog = guard(async () => { const n = $('#log-svc').value; if (n) $('#svc-log').textContent = (await api('/api/services/log?name=' + n)).log || '(пусто)'; });
$('#btn-log').onclick = loadLog;
$('#log-svc').onchange = loadLog;

// ---------- загрузки ----------
function renderDownloads() {
  const list = (S.state?.downloads || []).slice().reverse();
  const active = list.filter((d) => ['queued', 'running', 'unpacking'].includes(d.status));
  $('#dl-badge').textContent = active.length || '';
  $('#ov-dl-card').style.display = list.length ? '' : 'none';
  $('#ov-downloads').innerHTML = list.map((d) => {
    const pct = d.total ? (d.done / d.total) * 100 : 0;
    const info = d.status === 'running' ? `${gb(d.done)} / ${gb(d.total)} · ${gb(d.speed)}/с · осталось ${dur(d.eta)}` : d.error || '';
    return `<div class="dl"><div><b>${esc(d.title)}</b> ${tag(d.status)} <span class="small muted">${esc(d.file || '')} ${d.files_total > 1 ? `(${d.files_done}/${d.files_total})` : ''}</span></div>
      <div>${['queued', 'running'].includes(d.status) ? `<button class="btn small ghost" data-dl-cancel="${d.id}">Отменить</button>` : ''}</div>
      <div class="meter ${d.status === 'error' ? 'bad' : d.status === 'done' ? 'ok' : 'run'}"><span style="width:${d.status === 'done' ? 100 : pct}%"></span></div>
      <div class="small muted" style="grid-column:1/-1">${esc(info)}</div></div>`;
  }).join('');
}
document.addEventListener('click', guard(async (e) => {
  const t = e.target.closest('[data-dl-cancel]');
  if (t) await api('/api/downloads/cancel', { id: t.dataset.dlCancel });
}));

// ---------- запуски ----------
function runProgress(r) {
  const steps = r.steps || [];
  const done = steps.filter((s) => ['done', 'skipped', 'cancelled', 'error'].includes(s.status)).length;
  const run = steps.find((s) => s.status === 'running' && s.total);
  return { pct: steps.length ? ((done + (run ? run.done / run.total : 0)) / steps.length) * 100 : 0, done, n: steps.length };
}
function renderRunsList() {
  const runs = [...S.runs.values()].sort((a, b) => b.created - a.created);
  const active = runs.filter((r) => ['running', 'queued'].includes(r.status));
  $('#runs-badge').textContent = active.length || '';
  const item = (r) => {
    const p = runProgress(r);
    const wait = (r.steps || []).some((s) => s.status === 'approval');
    return `<div class="run-item ${r.id === S.selRun ? 'on' : ''}" data-run="${r.id}">
      <div class="row"><b class="grow">${esc(r.title)}</b>${wait ? tag('approval') : tag(r.status)}</div>
      <div class="small muted">${new Date(r.created * 1000).toLocaleString('ru')} · шагов ${p.done}/${p.n}</div>
      ${['running', 'queued'].includes(r.status) ? `<div class="meter run"><span style="width:${p.pct}%"></span></div>` : ''}</div>`;
  };
  $('#runs-list').innerHTML = runs.map(item).join('') || '<p class="empty" style="padding:10px">Запусков пока нет — вкладка «Скрипт».</p>';
  $('#ov-runs').innerHTML = runs.slice(0, 6).map(item).join('') || '<p class="empty">Запусков пока нет.</p>';
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-run]');
  if (t) { show('runs'); openRun(t.dataset.run); }
});
const openRun = guard(async (id) => {
  S.selRun = id; S.selStep = null; S.picks = new Set();
  S.detail = await api('/api/runs/' + id);
  S.runs.set(id, { ...S.runs.get(id), ...S.detail });
  renderRunsList(); renderRun();
});
function renderRun() {
  const r = S.detail;
  const box = $('#run-detail');
  if (!r) { box.innerHTML = '<div class="card"><p class="muted">Выберите запуск слева.</p></div>'; return; }
  const live = ['running', 'queued'].includes(r.status);
  const appr = r.steps.find((s) => s.status === 'approval');
  const sel = S.selStep && r.steps.find((s) => s.id === S.selStep);
  const showSteps = appr ? appr.approval.show : sel ? [sel.id] : null;
  const outs = r.steps.flatMap((s) => (s.outputs || []).map((o) => ({ ...o, step: s.id })))
    .filter((o) => !showSteps || showSteps.includes(o.step));
  const logStep = sel || r.steps.find((s) => s.status === 'running') || r.steps.find((s) => s.status === 'error') || r.steps[r.steps.length - 1];
  const p = runProgress(r);
  box.innerHTML = `
    <div class="card"><div class="row"><h3 class="grow" style="margin:0">${esc(r.title)}</h3>${tag(r.status)}
      ${live ? '<button class="btn small danger" id="run-cancel">Отменить</button>' : '<button class="btn small" id="run-rerun">Запустить снова</button>'}
      <button class="btn small ghost" id="run-edit">В редактор</button></div>
      ${r.description ? `<p class="muted" style="margin:6px 0 0">${esc(r.description)}</p>` : ''}
      <div class="small muted" style="margin:6px 0 10px">${esc(r.dir)} · ${dur(((r.finished || Date.now() / 1000) - r.created))}</div>
      <div class="meter ${r.status === 'error' ? 'bad' : r.status === 'done' ? 'ok' : 'run'}"><span style="width:${r.status === 'done' ? 100 : p.pct}%"></span></div></div>
    <div class="steps" style="margin-bottom:16px">${r.steps.map((s) => {
      const pct = s.total ? (s.done / s.total) * 100 : s.status === 'done' ? 100 : 0;
      return `<div class="step ${s.id === S.selStep ? 'on' : ''}" data-step="${s.id}">
        <div class="top"><b title="${esc(s.title)}">${esc(s.title)}</b><span class="small st-${s.status}">${esc(STATUS[s.status] || s.status)}</span></div>
        <div class="small muted">${esc(s.uses)}${s.model ? ' · ' + esc(s.model) : ''}${s.gpu != null && s.gpu !== 'auto' ? ' · карта ' + esc(s.gpu) : ''}${s.total ? ` · ${s.done}/${s.total}` : ''}${s.n_outputs || s.outputs?.length ? ` · ${s.outputs?.length ?? s.n_outputs} файлов` : ''}</div>
        <div class="meter ${s.status === 'error' ? 'bad' : s.status === 'done' ? 'ok' : 'run'}"><span style="width:${pct}%"></span></div>
        <div class="msg" title="${esc(s.error || s.message)}">${esc(s.error || s.message || '')}</div></div>`;
    }).join('')}</div>
    ${appr ? `<div class="approve-bar"><b>${esc(appr.title)}:</b> <span class="grow">${esc(appr.approval.message)}</span>
      <span id="pick-n">${S.picks.size} выбрано</span><button class="btn small ghost" id="pick-all">Все</button><button class="btn small ghost" id="pick-none">Сбросить</button>
      <button class="btn small primary" id="pick-ok">Утвердить</button></div>` : ''}
    <div class="card"><div class="row" style="margin-bottom:10px"><h3 class="grow" style="margin:0">Результаты${showSteps ? ': ' + esc(showSteps.join(', ')) : ''} <span class="muted">(${outs.length})</span></h3>
      ${sel ? '<button class="btn small ghost" id="step-all">Все шаги</button>' : ''}</div>
      <div class="gallery" id="gallery">${outs.slice(-400).map((o) => tile(o, !!appr)).join('') || '<p class="empty">Пока пусто.</p>'}</div></div>
    <div class="card"><h3>Журнал: ${esc(logStep?.title || '')}</h3><pre class="log" id="run-log">${esc((logStep?.log || []).join('\n'))}</pre></div>`;
  const lg = $('#run-log'); lg.scrollTop = lg.scrollHeight;
  hydrateTexts();
}
function tile(o, pickable) {
  const name = o.file?.split('/').pop() || o.path.split('/').pop();
  const url = fileUrl(o.path);
  let body = '<div class="thumb" data-open><span class="ico">📄</span></div>';
  if (o.kind === 'image') body = `<div class="thumb" data-open><img loading="lazy" src="${url}" alt=""></div>`;
  else if (o.kind === 'video') body = `<div class="thumb" data-open><video src="${url}#t=0.5" muted loop preload="metadata" onmouseenter="this.play()" onmouseleave="this.pause()"></video></div>`;
  else if (o.kind === 'audio') body = `<div class="thumb" style="aspect-ratio:auto;padding:14px 0 4px;cursor:default"><span class="ico">♪</span></div><audio controls preload="none" src="${url}"></audio>`;
  else if (o.kind === 'text') body = `<div class="txt" data-open data-text="${esc(o.path)}">…</div>`;
  else if (o.kind === 'model3d') body = '<div class="thumb"><span class="ico">⬢</span></div>';
  const sub = [o.item && o.item !== name.split('.')[0] ? o.item : '', o.seed != null ? 'сид ' + o.seed : '', o.cer != null ? 'CER ' + (o.cer * 100).toFixed(1) + '%' : '',
    o.reused ? 'готово раньше' : ''].filter(Boolean).join(' · ');
  const verdict = o.verdict ? `<span class="small" title="${esc(JSON.stringify(o.verdict))}">${esc(Object.entries(o.verdict).slice(0, 2).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '))}</span>` : '';
  const picked = S.picks.has(o.path);
  return `<div class="tile ${pickable ? 'pickable' : ''} ${picked ? 'picked' : ''}" data-path="${esc(o.path)}" data-kind="${o.kind}" data-prompt="${esc(o.prompt || o.text || '')}">
    ${pickable ? `<span class="pickmark">${picked ? '✓' : ''}</span><button class="zoom" data-zoom title="Открыть крупно">⤢</button>` : ''}${body}
    <div class="cap"><span title="${esc(o.path)}">${esc(name)}</span>${sub ? `<span class="muted">${esc(sub)}</span>` : ''}${verdict}</div></div>`;
}
const textCache = new Map();
async function hydrateTexts() {
  for (const el of $$('[data-text]')) {
    const p = el.dataset.text;
    if (!textCache.has(p)) { try { textCache.set(p, await (await fetch(fileUrl(p))).text()); } catch { textCache.set(p, '(не читается)'); } }
    el.textContent = textCache.get(p).slice(0, 700);
  }
}
$('#run-detail').addEventListener('click', guard(async (e) => {
  const r = S.detail;
  if (e.target.closest('#run-cancel')) { await api(`/api/runs/${r.id}/cancel`, {}); return; }
  if (e.target.closest('#run-rerun')) { const n = await api(`/api/runs/${r.id}/rerun`, {}); S.runs.set(n.id, n); openRun(n.id); return; }
  if (e.target.closest('#run-edit')) { setEditor(r.text || ''); show('script'); return; }
  if (e.target.closest('#step-all')) { S.selStep = null; renderRun(); return; }
  const st = e.target.closest('[data-step]');
  if (st) { S.selStep = S.selStep === st.dataset.step ? null : st.dataset.step; renderRun(); return; }
  const appr = r.steps.find((s) => s.status === 'approval');
  if (e.target.closest('#pick-ok')) { await api(`/api/runs/${r.id}/approve`, { step: appr.id, selected: [...S.picks] }); S.picks = new Set(); toast('Утверждено'); return; }
  if (e.target.closest('#pick-all')) { $$('#gallery .tile').forEach((t) => S.picks.add(t.dataset.path)); renderRun(); return; }
  if (e.target.closest('#pick-none')) { S.picks = new Set(); renderRun(); return; }
  const t = e.target.closest('.tile');
  if (!t || e.target.closest('audio')) return;
  if (e.target.closest('[data-zoom]')) return openLightbox(t);
  if (appr && t.classList.contains('pickable')) {
    S.picks.has(t.dataset.path) ? S.picks.delete(t.dataset.path) : S.picks.add(t.dataset.path);
    t.classList.toggle('picked'); t.querySelector('.pickmark').textContent = S.picks.has(t.dataset.path) ? '✓' : '';
    $('#pick-n').textContent = S.picks.size + ' выбрано';
    return;
  }
  if (e.target.closest('[data-open]')) openLightbox(t);
}));
function openLightbox(t) {
  const p = t.dataset.path, k = t.dataset.kind, url = fileUrl(p);
  let html = '';
  if (k === 'image') html = `<img src="${url}">`;
  else if (k === 'video') html = `<video src="${url}" controls autoplay loop></video>`;
  else html = `<pre>${esc(textCache.get(p) || '')}</pre>`;
  if (t.dataset.prompt) html += `<div class="small" style="max-width:900px;opacity:.85">${esc(t.dataset.prompt)}</div>`;
  html += `<div class="small" style="opacity:.6">${esc(p)}</div>`;
  $('#lb-body').innerHTML = html; $('#lightbox').hidden = false;
}
$('#lb-close').onclick = () => { $('#lightbox').hidden = true; $('#lb-body').innerHTML = ''; };
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') $('#lb-close').onclick(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#lightbox').hidden) $('#lb-close').onclick(); });

// ---------- скрипт ----------
const ed = $('#editor');
function setEditor(text) { ed.value = text; store.set('draft', text); S.plan = null; $('#btn-run').disabled = $('#btn-fetch').disabled = true; $('#plan').innerHTML = '<p class="muted">Скрипт загружен — нажмите «Проверить».</p>'; }
ed.value = store.get('draft', '');
ed.addEventListener('input', () => { store.set('draft', ed.value); $('#btn-run').disabled = true; });
ed.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { e.preventDefault(); const s = ed.selectionStart; ed.setRangeText('  ', s, ed.selectionEnd, 'end'); }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); planScript(); }
});
$('#file-in').onchange = async (e) => { const f = e.target.files[0]; if (f) setEditor(await f.text()); e.target.value = ''; };
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('drag'); });
drop.addEventListener('drop', async (e) => {
  e.preventDefault(); drop.classList.remove('drag');
  const f = e.dataTransfer.files[0];
  if (f) setEditor(await f.text()); else { const t = e.dataTransfer.getData('text'); if (t) setEditor(t); }
});
const loadScriptList = guard(async () => {
  const list = await api('/api/scripts');
  const groups = { examples: 'Примеры', scripts: 'Сохранённые' };
  $('#script-list').innerHTML = '<option value="">Примеры и сохранённые…</option>' + Object.entries(groups).map(([g, label]) => {
    const items = list.filter((x) => x.group === g);
    return items.length ? `<optgroup label="${label}">${items.map((x) => `<option value="${esc(x.path)}">${esc(x.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
});
$('#script-list').onchange = guard(async (e) => { if (e.target.value) setEditor((await api('/api/scripts/read?path=' + encodeURIComponent(e.target.value))).text); e.target.value = ''; });
$('#btn-save').onclick = guard(async () => { const r = await api('/api/scripts/save', { text: ed.value }); toast('Сохранено: ' + r.path); loadScriptList(); });
const planScript = guard(async () => {
  $('#plan').innerHTML = '<p class="muted">Проверяю…</p>';
  try { S.plan = await api('/api/scripts/plan', { text: ed.value }); } catch (e) { S.plan = { errors: [e.message], warnings: [], steps: [] }; }
  renderPlan();
});
$('#btn-plan').onclick = planScript;
function renderPlan() {
  const p = S.plan;
  const ok = !p.errors.length;
  $('#btn-run').disabled = !ok;
  $('#btn-fetch').disabled = !ok || !p.missing?.length;
  let h = '';
  if (p.errors.length) h += `<ul class="msgs err">${p.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  if (p.warnings?.length) h += `<ul class="msgs warn">${p.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  if (ok) {
    h += p.steps.map((s, i) => `<div class="plan-step"><span class="n">${i + 1}</span>
      <div><b>${esc(s.title)}</b> <span class="tag">${esc(s.uses)}</span></div>
      <div class="small">${s.units} ед.</div>
      <div class="small muted" style="grid-column:2/-1">${s.model_title ? esc(s.model_title) + ' ' : ''}${s.installed === false ? '<span class="tag warn">скачать</span> ' : s.model ? '<span class="tag ok">есть</span> ' : ''}${s.gpu != null && s.gpu !== 'auto' ? '· карта ' + esc(s.gpu) : ''}${s.after.length ? ' · после ' + esc(s.after.join(', ')) : ''}${s.eta_s ? ' · ~' + dur(s.eta_s) : ''}</div></div>`).join('');
    if (p.missing.length) h += `<p style="margin-top:12px"><b>Докачать:</b> ${p.missing.map((m) => `${esc(m.title)} (${m.size_gb} ГБ)`).join(', ')}</p>`;
    if (p.services.length) h += `<p class="small muted">Серверы: ${p.services.map(esc).join(', ')} — студия поднимет сама.</p>`;
    h += `<p class="small muted">Выход: ${esc(p.out)}${p.eta_s ? ' · оценка ' + dur(p.eta_s) : ''}</p>`;
  }
  $('#plan').innerHTML = h;
}
$('#btn-fetch').onclick = guard(async () => { const j = await api('/api/scripts/fetch', { text: ed.value }); toast(`В очереди загрузок: ${j.length}`); refreshState(); });
$('#btn-run').onclick = guard(async () => {
  if (S.plan?.missing?.length && !confirm('Не все модели скачаны — шаги с ними упадут. Всё равно запустить?')) return;
  const r = await api('/api/scripts/run', { text: ed.value, source: 'редактор' });
  S.runs.set(r.id, r); show('runs'); openRun(r.id);
});

// ---------- железо и подбор ----------
const loadHw = guard(async () => {
  $('#hw-info').innerHTML = '<p class="muted">Опрашиваю железо…</p>';
  S.hw = await api('/api/hw?purpose=' + S.purpose);
  renderHw();
});
$('#llm-purpose').onchange = (e) => { S.purpose = e.target.value; S.llmSel = null; loadHw(); };
function renderHw() {
  const { hw, recommend, llm } = S.hw;
  $('#hw-info').innerHTML = `<dl class="kv"><dt>Процессор</dt><dd>${esc(hw.cpu.name)} · ${hw.cpu.threads} потоков</dd>
    <dt>Память</dt><dd>${hw.ram.total_gb} ГБ (свободно ${hw.ram.free_gb})</dd><dt>Система</dt><dd>${esc(hw.os)}, Python ${esc(hw.python)}</dd>
    ${hw.gpus.map((g) => `<dt>Карта ${g.index}</dt><dd>${esc(g.name)} · ${g.vram_gb} ГБ (свободно ${g.free_gb}) · CUDA ${esc(g.cc)} · драйвер ${esc(g.driver)} · ~${g.bandwidth} ГБ/с</dd>`).join('')}
    ${hw.disks.map((d) => `<dt>Диск</dt><dd>${esc(d.path)}: свободно ${d.free_gb ?? '?'} из ${d.total_gb ?? '?'} ГБ</dd>`).join('')}
    ${hw.processes.length ? `<dt>Занимают карты</dt><dd>${hw.processes.map((p) => `${esc(p.name)} (pid ${p.pid})`).join(', ')}</dd>` : ''}</dl>
    ${hw.cuda13 ? '<p class="small muted">Есть карта Blackwell (RTX 50xx): для llama.cpp нужна сборка под CUDA 13 — студия ставит её сама.</p>' : ''}`;
  const names = Object.fromEntries((S.models.length ? S.models : []).map((m) => [m.id, m.title]));
  $('#hw-rec').innerHTML = `<div class="table-wrap"><table><tr><th>Задача</th><th>Модель</th><th>Карта</th><th>Почему</th><th></th></tr>
    ${Object.entries(recommend).map(([k, r]) => `<tr><td>${esc(S.state.kinds[k] || k)}</td><td><b>${esc(r.title)}</b>${r.alternatives.length ? `<div class="small muted">ещё: ${r.alternatives.map((a) => esc(names[a] || a)).join(', ')}</div>` : ''}</td>
      <td>${esc(r.gpu_name)}</td><td class="small">${esc(r.reason)}</td><td>${r.installed ? '<span class="tag ok">есть</span>' : `<button class="btn small" data-dl-model="${r.model}">Скачать ${r.missing_gb ? r.missing_gb + ' ГБ' : ''}</button>`}</td></tr>`).join('')}</table></div>`;
  const modes = Object.keys(llm);
  if (!S.llmMode || !llm[S.llmMode]) S.llmMode = modes[0];
  const M = { exclusive: 'Все карты под LLM', shared: 'Рядом с генерацией', cpu: 'Процессор' };
  const cur = llm[S.llmMode];
  const saved = S.state.config.llm_profile;
  const isSaved = (p) => saved && p.model === saved.model && p.quant === saved.quant && JSON.stringify(p.args) === JSON.stringify(saved.args);
  if (S.llmSel == null) S.llmSel = Math.max(0, cur.all.findIndex((p) => cur.best && p.model === cur.best.model && p.quant === cur.best.quant));
  const sp = cur.all[S.llmSel];
  $('#hw-llm').innerHTML = `<div class="row chips">${modes.map((m) => `<span class="chip ${m === S.llmMode ? 'on' : ''}" data-llm-mode="${m}">${M[m] || m}: ${esc(llm[m].gpus.join(' + '))}</span>`).join('')}</div>
    ${cur.all.length ? `<div class="table-wrap"><table><tr><th></th><th>Модель</th><th>Квант</th><th>Размер</th><th>Контекст</th><th>В RAM</th><th>Скорость*</th><th></th></tr>
    ${cur.all.map((p, i) => `<tr class="${i === S.llmSel ? 'sel' : ''}" data-llm-i="${i}" style="cursor:pointer"><td><input type="radio" name="llmp" ${i === S.llmSel ? 'checked' : ''}></td>
      <td><b>${esc(p.title)}</b>${p.vision ? ' <span class="tag info">зрение</span>' : ''}${p.moe ? ' <span class="tag">MoE</span>' : ''}${cur.best && p.model === cur.best.model && p.quant === cur.best.quant ? ' <span class="tag acc">лучший</span>' : ''}${isSaved(p) ? ' <span class="tag ok">основной</span>' : ''}</td>
      <td>${esc(p.quant)}</td><td>${p.size_gb} ГБ</td><td>${(p.ctx / 1024).toFixed(0)}K</td><td>${p.cpu_gb ? p.cpu_gb + ' ГБ' : '—'}</td><td>${p.tps ?? '?'} ток/с</td>
      <td>${p.installed ? '<span class="tag ok">есть</span>' : '<span class="tag">скачать</span>'}</td></tr>`).join('')}</table></div>
    <p class="small muted">* оценка по полосе памяти карт; «Замерить» запустит модель и даст настоящую скорость.</p>` : '<p class="muted">Ни одна модель каталога не влезает — добавьте поменьше на вкладке «Модели».</p>'}
    ${sp ? `<div class="card" style="background:var(--panel2);margin:12px 0 0"><b>${esc(sp.title)} ${esc(sp.quant)}</b>
      <pre style="margin:8px 0;white-space:pre-wrap;word-break:break-all">llama-server ${esc((sp.path ? '-m ' + sp.path + ' ' : '') + sp.args.join(' '))}</pre>
      <div class="row">${sp.installed ? `<button class="btn primary" id="llm-save">Сделать основным</button><button class="btn" id="llm-start">Запустить</button><button class="btn ghost" id="llm-bench">Замерить скорость</button>`
        : `<button class="btn primary" data-dl-model="${sp.model}" data-quant="${esc(sp.quant)}">Скачать ${sp.size_gb} ГБ</button>`}<span class="muted small" id="bench-out"></span></div></div>` : ''}`;
}
$('#hw-llm').addEventListener('click', guard(async (e) => {
  const m = e.target.closest('[data-llm-mode]');
  if (m) { S.llmMode = m.dataset.llmMode; S.llmSel = null; renderHw(); return; }
  const r = e.target.closest('[data-llm-i]');
  if (r) { S.llmSel = +r.dataset.llmI; renderHw(); return; }
  const sp = S.hw.llm[S.llmMode].all[S.llmSel];
  if (e.target.closest('#llm-save')) { await api('/api/llm/profile', { profile: sp }); S.state.config.llm_profile = sp; toast('Основная LLM сохранена'); renderHw(); }
  if (e.target.closest('#llm-start')) {
    const s = S.state.services.find((x) => x.name === 'llm');
    if (s && ['running', 'starting'].includes(s.state)) await api('/api/services/stop', { name: 'llm' });
    await api('/api/services/start', { name: 'llm', profile: sp }); toast('LLM запускается — состояние на «Обзоре»');
  }
  if (e.target.closest('#llm-bench')) {
    $('#bench-out').textContent = 'замеряю…';
    const b = await api('/api/llm/bench', {});
    $('#bench-out').textContent = `генерация ${b.gen_tps} ток/с · разбор промпта ${b.prompt_tps} ток/с`;
  }
}));
document.addEventListener('click', guard(async (e) => {
  const t = e.target.closest('[data-dl-model]');
  if (!t) return;
  const quant = t.dataset.quant || ($(`[data-quant-for="${t.dataset.dlModel}"]`)?.value);
  t.disabled = true;
  const j = await api('/api/models/download', { id: t.dataset.dlModel, quant });
  toast(j.note || 'В очереди загрузок: ' + j.title);
  refreshState();
}));

// ---------- модели ----------
const loadModels = guard(async () => { S.models = await api('/api/models'); renderModels(); });
function maxVram() { return Math.max(0, ...((S.hw?.hw.gpus || S.liveGpus || []).map((g) => g.vram_gb))); }
function renderModels() {
  const kinds = ['all', 'fits', ...Object.keys(S.state.kinds)];
  const label = { all: 'Все', fits: 'Подходят железу', ...S.state.kinds };
  $('#kind-chips').innerHTML = kinds.map((k) => `<span class="chip ${k === S.kind ? 'on' : ''}" data-kind="${k}">${esc(label[k])}</span>`).join('');
  const mv = maxVram();
  const fits = (m) => m.kind === 'llm' || !m.vram_gb || m.vram_gb <= mv;
  const list = S.models.filter((m) => S.kind === 'all' || (S.kind === 'fits' ? fits(m) : m.kind === S.kind));
  $('#models').innerHTML = list.map((m) => {
    const st = m.status;
    const local = m.kind === 'llm' ? (st.files || []).map((f) => `${esc(f.name)} · ${f.size_gb} ГБ`).join('<br>') : '';
    return `<div class="card model"><div class="top"><b>${esc(m.title)}</b><span class="tag">${esc(m.kind_title)}</span></div>
      <div class="row">${st.installed ? '<span class="tag ok">на диске</span>' : '<span class="tag">нет на диске</span>'}
        ${m.vram_gb ? `<span class="tag ${fits(m) ? 'ok' : 'bad'}">от ${m.vram_gb} ГБ видеопамяти</span>` : ''}
        ${m.params_b ? `<span class="tag">${m.params_b}B${m.moe ? ` (акт. ${m.active_b}B)` : ''}</span>` : ''}
        <span class="tag">${esc(m.license || '?')}</span>${m.verify ? '<span class="tag warn" title="Источник не проверен вручную — нажмите «Проверить источник»">источник?</span>' : ''}${m.custom ? '<span class="tag info">своя</span>' : ''}</div>
      ${m.notes ? `<p>${esc(m.notes)}</p>` : ''}${local ? `<p class="small">${local}</p>` : ''}
      <div class="foot">${m.kind === 'llm' ? `<select data-quant-for="${m.id}">${(m.quants || []).map((q) => `<option>${esc(q)}</option>`).join('')}</select><button class="btn small" data-dl-model="${m.id}">Скачать</button>`
        : st.installed ? '' : `<button class="btn small" data-dl-model="${m.id}">Скачать ${st.missing_gb ? st.missing_gb + ' ГБ' : ''}</button>`}
        <button class="btn small ghost" data-check="${m.id}">Проверить источник</button></div>
      <div class="small muted" data-check-out="${m.id}"></div></div>`;
  }).join('') || '<p class="empty">Нет моделей в этой группе.</p>';
}
$('#kind-chips').addEventListener('click', (e) => { const c = e.target.closest('[data-kind]'); if (c) { S.kind = c.dataset.kind; renderModels(); } });
$('#models').addEventListener('click', guard(async (e) => {
  const c = e.target.closest('[data-check]');
  if (!c) return;
  const out = $(`[data-check-out="${c.dataset.check}"]`);
  out.textContent = 'проверяю…';
  const res = await api('/api/models/check', { id: c.dataset.check });
  out.innerHTML = res.map((r) => `<div style="color:var(--${r.ok ? 'ok' : 'bad'})">${r.ok ? '✓' : '✗'} ${esc(r.detail)}</div>`).join('');
}));
$('#btn-hf').onclick = guard(async () => {
  const repo = $('#hf-repo').value.trim();
  if (!repo) return;
  $('#hf-files').innerHTML = '<p class="muted">Читаю репозиторий…</p>';
  const files = await api('/api/models/hf', { repo });
  const ggufs = files.filter((f) => f.path.endsWith('.gguf') && !f.path.toLowerCase().includes('mmproj'));
  const total = files.reduce((a, f) => a + f.size, 0);
  const pb = (repo.match(/(\d+(?:\.\d+)?)[bB]/) || [])[1];
  $('#hf-files').innerHTML = ggufs.length
    ? `<p>GGUF — языковая модель. Параметров (млрд): <input id="hf-params" value="${pb || 7}" style="width:70px"> <label><input type="checkbox" id="hf-moe"> MoE</label></p>
       <div class="table-wrap"><table>${ggufs.map((f) => `<tr><td>${esc(f.path)}</td><td>${gb(f.size)}</td><td><button class="btn small" data-hf-add="${esc(f.path)}">Добавить и скачать</button></td></tr>`).join('')}</table></div>`
    : `<p>${files.length} файлов, ${gb(total)}. Для чего модель: <select id="hf-kind">${Object.entries(S.state.kinds).filter(([k]) => k !== 'llm').map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
       <button class="btn small" data-hf-add="">Добавить репозиторий целиком</button></p><p class="small muted">Свой раннер для таких моделей — шаг python в скрипте; модель ляжет в папку моделей.</p>`;
});
$('#hf-files').addEventListener('click', guard(async (e) => {
  const b = e.target.closest('[data-hf-add]');
  if (!b) return;
  const repo = $('#hf-repo').value.trim();
  const body = b.dataset.hfAdd
    ? { hf: repo, kind: 'llm', quant: guessQuant(b.dataset.hfAdd), params_b: +$('#hf-params').value || 7, moe: $('#hf-moe').checked }
    : { hf: repo, kind: $('#hf-kind').value };
  const m = await api('/api/models/add', body);
  const j = await api('/api/models/download', { id: m.id, quant: body.quant });
  toast(`${m.title}: ${j.note || 'в очереди загрузок'}`); loadModels(); refreshState();
}));
function guessQuant(name) {
  const n = name.toUpperCase();
  const qs = ['Q8_K_XL', 'Q6_K_XL', 'Q5_K_XL', 'Q4_K_XL', 'Q3_K_XL', 'IQ4_XS', 'IQ4_NL', 'IQ3_XXS', 'Q8_0', 'Q6_K', 'Q5_K_M', 'Q5_K_S', 'Q4_K_M', 'Q4_K_S', 'Q4_0', 'Q3_K_M', 'Q3_K_S', 'Q2_K', 'BF16', 'F16'];
  const q = qs.find((x) => n.includes(x)) || 'Q4_K_M';
  return (n.includes('UD-' + q) ? 'UD-' : '') + q;
}

// ---------- движки ----------
const loadEngines = guard(async () => {
  const e = S.engines = await api('/api/engines');
  const pkgs = {};
  for (const m of (S.models.length ? S.models : await api('/api/models'))) {
    if (!m.python) continue;
    const k = m.python.replace('venv:', '');
    pkgs[k] ||= new Set();
    (m.pip || []).forEach((x) => pkgs[k].add(x));
  }
  $('#engines').innerHTML = `<div class="table-wrap"><table>
    <tr><td><b>llama.cpp</b></td><td>${e.llama.installed ? `<span class="tag ok">есть</span> <span class="small muted">${esc(e.llama.version || '')}</span>` : '<span class="tag bad">нет</span>'}<div class="small muted">${esc(e.llama.path)}</div></td>
      <td><button class="btn small" id="llama-install">${e.llama.installed ? 'Обновить' : 'Установить'} с GitHub</button></td></tr>
    <tr><td><b>ComfyUI</b></td><td>${e.comfy.installed ? '<span class="tag ok">есть</span>' : '<span class="tag bad">не найден</span>'}<div class="small muted">${esc(e.comfy.path || 'укажите папку в Настройках')}${e.comfy.python ? ' · ' + esc(e.comfy.python) : ''}</div></td>
      <td>${e.comfy.installed ? '' : '<a class="btn small ghost" href="https://github.com/comfyanonymous/ComfyUI/releases" target="_blank">Скачать (portable)</a>'}</td></tr>
    <tr><td><b>ffmpeg</b></td><td>${e.ffmpeg.installed ? '<span class="tag ok">есть</span>' : '<span class="tag warn">нет</span>'}<div class="small muted">${esc(e.ffmpeg.path || 'нужен для звука и озвучки')}</div></td><td></td></tr>
    ${e.venvs.map((v) => `<tr><td><b>окружение ${esc(v.name)}</b></td><td>${v.python ? '<span class="tag ok">есть</span>' : '<span class="tag warn">нет</span>'}<div class="small muted">${esc(v.python || v.path || '')}${v.used_by.length ? ' · для: ' + esc(v.used_by.join(', ')) : ''}</div></td>
      <td>${v.python ? '' : `<button class="btn small" data-venv="${esc(v.name)}" data-pkgs="${esc([...(pkgs[v.name] || [])].join(' '))}">Создать</button>`}</td></tr>`).join('')}
  </table></div>`;
});
$('#engines').addEventListener('click', guard(async (e) => {
  if (e.target.closest('#llama-install')) { const j = await api('/api/engines/llama/install', {}); toast('Качаю ' + j.title); refreshState(); }
  const v = e.target.closest('[data-venv]');
  if (v && confirm(`Создать окружение ${v.dataset.venv}: PyTorch (CUDA 12.8) + ${v.dataset.pkgs || 'пакеты'}? Это несколько гигабайт.`)) {
    const r = await api('/api/engines/venv', { name: v.dataset.venv, packages: v.dataset.pkgs.split(' ').filter(Boolean) });
    S.runs.set(r.id, r); show('runs'); openRun(r.id);
  }
}));

// ---------- формат ----------
function md(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  let h = '', i = 0;
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('```')) { const buf = []; i++; while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]); i++; h += `<pre><code>${esc(buf.join('\n'))}</code></pre>`; continue; }
    const m = l.match(/^(#{1,4})\s+(.*)/);
    if (m) { h += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; i++; continue; }
    if (l.startsWith('|')) {
      const rows = []; while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      h += '<table><tr>' + cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr>' + rows.slice(2).map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</table>';
      continue;
    }
    if (/^\s*[-*] /.test(l)) { h += '<ul>'; while (i < lines.length && /^\s*[-*] /.test(lines[i])) h += `<li>${inline(lines[i++].replace(/^\s*[-*] /, ''))}</li>`; h += '</ul>'; continue; }
    if (l.startsWith('>')) { const buf = []; while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, '')); h += `<blockquote>${inline(buf.join(' '))}</blockquote>`; continue; }
    if (!l.trim()) { i++; continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^(#|```|\||>|\s*[-*] )/.test(lines[i])) buf.push(lines[i++]);
    h += `<p>${inline(buf.join(' '))}</p>`;
  }
  return h;
}
const loadFormat = guard(async () => { $('#format-doc').innerHTML = md(await api('/api/docs/format')); });
$('#btn-prompt').onclick = guard(async () => {
  const text = await api('/api/docs/prompt');
  try { await navigator.clipboard.writeText(text); $('#copied').textContent = `скопировано ${text.length} символов — вставьте в чат с LLM и опишите задачу`; }
  catch { $('#lb-body').innerHTML = `<pre>${esc(text)}</pre>`; $('#lightbox').hidden = false; }
});

// ---------- настройки ----------
const FIELDS = [
  ['h', 'Пути'], ['ai_root', 'Корень ИИ-стека'], ['comfy_dir', 'Папка ComfyUI'], ['comfy_python', 'Питон ComfyUI'], ['llama_dir', 'Папка llama.cpp'],
  ['llm_dir', 'Папка GGUF-моделей'], ['models_dir', 'Папка прочих моделей'], ['out_dir', 'Выход запусков'], ['ffmpeg', 'ffmpeg'],
  ['venvs', 'Окружения (имя = путь)', 'venvs'],
  ['h', 'Карты и порты'], ['gpu_roles.big', 'Большая карта (картинки, видео)', 'num'], ['gpu_roles.small', 'Малая карта (звук, вырезка)', 'num'],
  ['ports.llm', 'Порт LLM', 'num'], ['ports.comfy-big', 'Порт ComfyUI (большая)', 'num'], ['ports.comfy-small', 'Порт ComfyUI (малая)', 'num'], ['port', 'Порт студии (после перезапуска)', 'num'],
  ['auto_switch', 'Останавливать свои серверы, если шагу не хватает видеопамяти', 'bool'],
  ['h', 'Загрузки'], ['hf_endpoint', 'Адрес Hugging Face'], ['hf_mirrors', 'Зеркала (через запятую)', 'list'], ['modelscope', 'Запасной источник ModelScope', 'bool'],
  ['hf_token', 'Токен Hugging Face (для закрытых моделей)', 'secret'], ['ipv4_only', 'Только IPv4', 'bool'], ['parallel_downloads', 'Загрузок одновременно', 'num'],
];
const getp = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function renderSettings() {
  const c = S.state.config;
  $('#settings').innerHTML = FIELDS.map(([k, label, type]) => {
    if (k === 'h') return `<h4>${label}</h4>`;
    const v = getp(c, k);
    if (type === 'bool') return `<label for="f-${k}">${label}</label><input type="checkbox" id="f-${k}" data-k="${k}" data-t="bool" ${v ? 'checked' : ''} style="justify-self:start">`;
    if (type === 'venvs') return `<label>${label}</label><textarea data-k="${k}" data-t="venvs" rows="4">${esc(Object.entries(v || {}).map(([a, b]) => `${a} = ${b}`).join('\n'))}</textarea>`;
    const val = type === 'list' ? (v || []).join(', ') : v ?? '';
    return `<label for="f-${k}">${label}</label><input id="f-${k}" data-k="${k}" data-t="${type || 'str'}" ${type === 'secret' ? 'type="password" autocomplete="off"' : ''} value="${esc(val)}">`;
  }).join('') + '<div class="full row"><span class="grow"></span><button class="btn primary" type="submit">Сохранить</button></div>';
}
$('#settings').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const patch = {};
  $$('[data-k]', e.target).forEach((el) => {
    const [k, sub] = el.dataset.k.split(/\.(.+)/);
    let v = el.dataset.t === 'bool' ? el.checked : el.value.trim();
    if (el.dataset.t === 'num') v = v === '' ? null : +v;
    if (el.dataset.t === 'list') v = v.split(',').map((x) => x.trim()).filter(Boolean);
    if (el.dataset.t === 'venvs') v = Object.fromEntries(v.split('\n').map((x) => x.split('=').map((y) => y.trim())).filter((x) => x[0] && x[1]));
    if (sub) { patch[k] ||= { ...S.state.config[k] }; patch[k][sub] = v; } else patch[k] = v;
  });
  S.state.config = await api('/api/config', patch);
  toast('Сохранено'); S.hw = null;
}));

// ---------- события ----------
function onEvent(ev) {
  const { type, data } = ev;
  if (type === 'hw') { S.liveGpus = data.gpus; renderLive(data); return; }
  if (type === 'service') { const i = S.state.services.findIndex((s) => s.name === data.name); if (i >= 0) S.state.services[i] = data; renderServices(); return; }
  if (type === 'download') {
    const i = S.state.downloads.findIndex((d) => d.id === data.id); i >= 0 ? (S.state.downloads[i] = data) : S.state.downloads.push(data);
    renderDownloads(); if (data.status === 'done') { if ($('#tab-models').classList.contains('on')) loadModels(); if ($('#tab-services').classList.contains('on')) loadEngines(); }
    return;
  }
  if (type === 'engines') { loadEngines(); return; }
  if (type === 'run') { S.runs.set(data.id, { ...S.runs.get(data.id), ...data }); if (S.detail?.id === data.id) { Object.assign(S.detail, { status: data.status, finished: data.finished }); schedule(); } renderRunsList(); return; }
  if (type === 'step') {
    const r = S.runs.get(data.run);
    if (r) { const i = r.steps.findIndex((s) => s.id === data.id); if (i >= 0) r.steps[i] = { ...r.steps[i], ...data }; }
    if (S.detail?.id === data.run) { const s = S.detail.steps.find((x) => x.id === data.id); if (s) Object.assign(s, data); schedule(); }
    renderRunsList(); return;
  }
  if (type === 'output' && S.detail?.id === data.run) { const s = S.detail.steps.find((x) => x.id === data.step); if (s) (s.outputs ||= []).push(data); schedule(); return; }
  if (type === 'log' && S.detail?.id === data.run) {
    const s = S.detail.steps.find((x) => x.id === data.step); if (s) { (s.log ||= []).push(data.line); if (s.log.length > 400) s.log.shift(); }
    const lg = $('#run-log');
    if (lg && $('#tab-runs').classList.contains('on')) schedule();
  }
}
let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if ($('#tab-runs').classList.contains('on')) renderRun(); }); }
function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch (e) { console.error(e); } };
  es.onerror = () => { es.close(); setTimeout(() => { refreshState(); connect(); }, 2000); };
}
const refreshState = guard(async () => {
  S.state = await api('/api/state');
  $('#ver').textContent = 'версия ' + S.state.version;
  for (const r of S.state.runs) S.runs.set(r.id, { ...S.runs.get(r.id), ...r });
  renderServices(); renderDownloads(); renderRunsList();
});

(async () => {
  await refreshState();
  connect(); loadScriptList(); loadModels();
  const tab = store.get('tab', 'overview');
  show(tab);
  const live = [...S.runs.values()].find((r) => ['running', 'queued'].includes(r.status));
  if (live) openRun(live.id);
})();
