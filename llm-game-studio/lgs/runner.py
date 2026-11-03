"""Запуск скрипта: план (что нужно, что докачать), расписание шагов по картам, прогресс и результаты в реальном времени."""
import collections
import datetime
import json
import pathlib
import threading
import time
import traceback
import uuid

from . import advisor, catalog, config, events, hardware, script

RUNS_DIR = config.DATA / 'runs'
RUNS: dict[str, 'Run'] = {}
ADAPTERS: dict = {}   # uses → функция(ctx, units); регистрируют модули steps_*


def adapter(*names):
    def deco(fn):
        for n in names:
            ADAPTERS[n] = fn
        return fn
    return deco


# ---------- выбор модели и карты ----------

_rec_cache = {'t': 0, 'v': None}


def recommendations() -> dict:
    if time.time() - _rec_cache['t'] > 30 or _rec_cache['v'] is None:
        _rec_cache['v'] = advisor.recommend(hardware.snapshot())
        _rec_cache['t'] = time.time()
    return _rec_cache['v']


def resolve(st: dict) -> tuple[dict | None, object, list[str]]:
    """Модель (запись каталога), карта, предупреждения — для шага."""
    warn = []
    kind = script.STEP_TYPES.get(st.get('uses'), (None,))[0]
    want = st.get('model', 'auto')
    model = None
    if kind == 'llm':
        return None, None, warn
    if want and want != 'auto':
        model = catalog.get(want)
        if not model:
            warn.append(f'шаг «{st["id"]}»: модели «{want}» нет в каталоге')
    elif kind:
        r = recommendations().get(kind)
        model = catalog.get(r['model']) if r else None
        if not model:
            warn.append(f'шаг «{st["id"]}»: под «{kind}» в каталоге нет моделей')
    gpu = st.get('gpu', 'auto')
    if gpu == 'auto' and not model and st.get('uses') != 'comfy':
        gpu = None                         # свой скрипт, отбор, сервисы — без карты, пока её не указали явно
    elif gpu == 'auto':
        r = recommendations().get(model['kind']) if model else None
        gpu = r['gpu'] if r else (config.CFG['gpu_roles'].get('big', 0) if hardware.gpus() else 'cpu')
    return model, gpu, warn


def plan(sc: dict) -> dict:
    errors, warnings = script.check(sc)
    res = {'errors': errors, 'warnings': warnings, 'steps': [], 'missing': [], 'services': [], 'eta_s': 0,
           'out': str(script.run_dir(sc)) if not errors else None}
    if errors:
        return res
    missing = {}
    services = set()
    for r in sc.get('requires') or []:
        if r.get('model'):
            m = catalog.get(r['model'])
            if not m:
                warnings.append(f'requires: модели «{r["model"]}» нет в каталоге')
            elif not catalog.status(m)['installed']:
                missing[m['id']] = m
        elif r.get('hf'):
            m = custom_from_requires(r)
            if not catalog.status(m)['installed']:
                missing[m['id']] = m
        elif r.get('kind'):
            rec = recommendations().get(r['kind'])
            if rec and not rec['installed']:
                missing[rec['model']] = catalog.get(rec['model'])
    for st in sc['steps']:
        model, gpu, w = resolve(st)
        warnings += w
        uses = st['uses']
        n = _count_units(sc, st)
        eta = (model or {}).get('sec_per_item', 0) * (n if isinstance(n, int) else 0)
        info = {'id': st['id'], 'title': st.get('title') or st['id'], 'uses': uses, 'units': n, 'gpu': gpu,
                'model': model['id'] if model else None, 'model_title': model['title'] if model else None,
                'after': script.deps(st), 'eta_s': eta}
        if model:
            stt = catalog.status(model)
            info['installed'] = stt['installed']
            if not stt['installed']:
                missing[model['id']] = model
            if model.get('engine') == 'comfy':
                services.add(_comfy_name(gpu))
            if model.get('engine') == 'python':
                py = config.venv_python(model.get('python', ''))
                if not py:
                    warnings.append(f'шаг «{st["id"]}»: нет окружения {model.get("python")} для {model["title"]} (Настройки → окружения)')
        if uses in ('llm', 'vlm', 'code'):
            services.add('llm')
            prof = config.CFG.get('llm_profile')
            if not prof:
                warnings.append('LLM: профиль не выбран — возьму лучший по железу (вкладка «Железо»)')
            elif uses == 'vlm' and not prof.get('vision'):
                warnings.append(f'шаг «{st["id"]}»: выбранная LLM без зрения — для vlm нужна модель с mmproj')
            info['model_title'] = (prof or {}).get('title', 'LLM по железу')
        if uses == 'comfy':
            services.add(_comfy_name(gpu))
        res['eta_s'] += eta
        res['steps'].append(info)
    res['missing'] = [{'id': m['id'], 'title': m['title'], 'kind': m['kind'],
                       'size_gb': catalog.status(m).get('missing_gb') or round(m.get('params_b', 0) * 0.6, 1)}
                      for m in missing.values() if m]
    res['services'] = sorted(services)
    return res


def _comfy_name(gpu) -> str:
    return 'comfy-small' if gpu not in ('auto', 'cpu', None) and int(gpu) != config.CFG['gpu_roles'].get('big', 0) else 'comfy-big'


def _count_units(sc, st):
    if st.get('items_from') or st.get('inputs'):
        try:
            return len(script.units(sc, st))
        except (script.ScriptError, OSError, ValueError):
            return '?'
    n = len(st.get('items') or [None])
    return n * len(st.get('seeds') or [None])


def custom_from_requires(r: dict) -> dict:
    """requires: {hf: repo, file|quant, kind, id} → запись каталога (сохраняется в свои модели)."""
    repo = r['hf']
    kind = r.get('kind') or ('llm' if (r.get('quant') or str(r.get('file', '')).endswith('.gguf')) else 'image')
    mid = r.get('id') or repo.split('/')[-1].lower()
    old = catalog.get(mid)
    if old:
        return old
    if kind == 'llm':
        entry = {'id': mid, 'kind': 'llm', 'title': repo.split('/')[-1], 'engine': 'llama.cpp', 'repo': repo,
                 'params_b': r.get('params_b', 8), 'active_b': r.get('active_b', r.get('params_b', 8)),
                 'moe': r.get('moe', False), 'quants': [r.get('quant', 'Q4_K_M')], 'quality': r.get('quality', 6),
                 'tasks': r.get('tasks', ['text', 'code']), 'ctx_max': r.get('ctx_max', 32768), 'license': r.get('license', '?')}
    else:
        f = {'repo': repo, 'dest': r.get('dest', f'models:{kind}/{mid}')}
        if r.get('file'):
            f.update({'path': r['file'], 'role': r.get('role', 'ckpt')})
        else:
            f.update({'snapshot': True, 'check': r.get('check', 'config.json')})
        entry = {'id': mid, 'kind': kind, 'title': repo.split('/')[-1], 'engine': r.get('engine', 'python'),
                 'files': [f], 'vram_gb': r.get('vram_gb', 4), 'quality': r.get('quality', 5), 'license': r.get('license', '?')}
    catalog.add_custom(entry)
    return entry


# ---------- запуск ----------

class StepState:
    def __init__(self, st: dict):
        self.id = st['id']
        self.title = st.get('title') or st['id']
        self.uses = st['uses']
        self.after = script.deps(st)
        self.status = 'pending'
        self.done = 0
        self.total = 0
        self.message = ''
        self.error = None
        self.started = None
        self.finished = None
        self.model = None
        self.gpu = None
        self.outputs: list[dict] = []
        self.log = collections.deque(maxlen=400)
        self.approval = None      # для approve: что показать

    def public(self, full=False) -> dict:
        d = {k: getattr(self, k) for k in ('id', 'title', 'uses', 'after', 'status', 'done', 'total', 'message', 'error',
                                           'started', 'finished', 'model', 'gpu', 'approval')}
        d['n_outputs'] = len(self.outputs)
        if full:
            d['outputs'] = self.outputs
            d['log'] = list(self.log)
        return d


class Run:
    def __init__(self, sc: dict, text: str, source: str = ''):
        self.id = datetime.datetime.now().strftime('%m%d-%H%M%S-') + uuid.uuid4().hex[:4]
        self.sc = sc
        self.text = text
        self.source = source
        self.name = sc['name']
        self.title = sc.get('title') or sc['name']
        self.dir = script.run_dir(sc)
        self.status = 'queued'
        self.created = time.time()
        self.finished = None
        self.steps = {st['id']: StepState(st) for st in sc['steps']}
        self.cancel = threading.Event()
        self.procs: set = set()
        self.approvals: dict[str, threading.Event] = {}
        self.selected: dict[str, list] = {}
        self.locks_held: set = set()
        self._saved = 0.0

    def public(self, full=False) -> dict:
        d = {'id': self.id, 'name': self.name, 'title': self.title, 'status': self.status, 'created': self.created,
             'finished': self.finished, 'dir': str(self.dir), 'source': self.source,
             'description': self.sc.get('description', ''),
             'steps': [s.public(full) for s in self.steps.values()]}
        if full:
            d['text'] = self.text
        return d

    def emit_step(self, s: StepState):
        events.publish('step', {'run': self.id, **s.public()})
        self.save()

    def save(self, force=False):
        if not force and time.time() - self._saved < 2:
            return
        self._saved = time.time()
        RUNS_DIR.mkdir(parents=True, exist_ok=True)
        (RUNS_DIR / f'{self.id}.json').write_text(json.dumps(self.public(True), ensure_ascii=False, default=str), encoding='utf-8')


class StepCtx:
    """Что получает исполнитель шага."""

    def __init__(self, run: Run, st: dict, state: StepState, model, gpu):
        self.run, self.st, self.state, self.model, self.gpu = run, st, state, model, gpu
        self.dir = script.step_dir(run.sc, st)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.manifest_path = self.dir / 'manifest.json'
        self.manifest = []
        if self.manifest_path.exists() and not st.get('force'):
            try:
                self.manifest = json.loads(self.manifest_path.read_text(encoding='utf-8'))
            except ValueError:
                self.manifest = []
        self._last_emit = 0.0

    @property
    def cancelled(self) -> bool:
        return self.run.cancel.is_set()

    def check(self):
        if self.cancelled:
            raise Cancelled()

    def log(self, line: str):
        line = str(line).rstrip()
        if not line:
            return
        self.state.log.append(line)
        events.publish('log', {'run': self.run.id, 'step': self.state.id, 'line': line})

    def progress(self, done=None, total=None, message=None):
        if done is not None:
            self.state.done = done
        if total is not None:
            self.state.total = total
        if message is not None:
            self.state.message = message
        now = time.time()
        if now - self._last_emit > 0.25 or done == total:
            self._last_emit = now
            self.run.emit_step(self.state)

    def is_done(self, key: str) -> bool:
        return any(m.get('key') == key and (self.dir / m['file']).exists() for m in self.manifest)

    def output(self, path, key: str | None = None, **meta):
        """Зарегистрировать результат: в манифест шага и в интерфейс (превью)."""
        p = pathlib.Path(path)
        rel = p.relative_to(self.dir).as_posix() if p.is_relative_to(self.dir) else str(p)
        entry = {'file': rel, 'key': key or p.stem, 'kind': file_kind(p),
                 'model': (self.model or {}).get('id'), 'license': (self.model or {}).get('license'),
                 'made': datetime.datetime.now().isoformat(timespec='seconds'), **meta}
        self.manifest = [m for m in self.manifest if m.get('file') != rel] + [entry]
        self.manifest_path.write_text(json.dumps(self.manifest, ensure_ascii=False, indent=1), encoding='utf-8')
        out = {**entry, 'path': str(p).replace('\\', '/'), 'step': self.state.id}
        self.state.outputs.append(out)
        events.publish('output', {'run': self.run.id, **out})

    def reuse(self, key: str):
        """Готовое с прошлого запуска — показать в превью, не пересчитывать."""
        for m in self.manifest:
            if m.get('key') == key:
                self.state.outputs.append({**m, 'path': str(self.dir / m['file']).replace('\\', '/'), 'step': self.state.id, 'reused': True})


class Cancelled(Exception):
    pass


def file_kind(p: pathlib.Path) -> str:
    ext = p.suffix.lower()
    if ext in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp'):
        return 'image'
    if ext in ('.wav', '.ogg', '.mp3', '.flac', '.opus', '.m4a'):
        return 'audio'
    if ext in ('.mp4', '.webm', '.mov', '.mkv'):
        return 'video'
    if ext in ('.glb', '.gltf', '.obj'):
        return 'model3d'
    if ext in ('.json', '.md', '.txt', '.yaml', '.yml', '.abc', '.csv', '.ts', '.js', '.py', '.html', '.css'):
        return 'text'
    return 'file'


_global_locks: dict[str, str] = {}   # ресурс → id запуска/шага
_glock = threading.Lock()


def _resources(st: dict, model, gpu) -> set[str]:
    uses = st['uses']
    if uses in ('llm', 'vlm', 'code'):
        return {'llm'}
    if uses in ('approve', 'service'):
        return set()
    if uses in ('shell', 'python') and st.get('gpu', 'auto') == 'auto':
        return set()                       # своя команда: на карту претендует, только если gpu указан явно
    if gpu in (None, 'cpu'):
        return {'cpu-heavy'} if model else set()
    return {f'gpu:{gpu}'}


def start(sc: dict, text: str, source: str = '') -> Run:
    errors = script.validate(sc)
    if errors:
        raise script.ScriptError('; '.join(errors))
    run = Run(sc, text, source)
    RUNS[run.id] = run
    run.dir.mkdir(parents=True, exist_ok=True)
    (run.dir / 'script.lgs.yaml').write_text(text, encoding='utf-8')
    threading.Thread(target=_schedule, args=(run,), daemon=True).start()
    events.publish('run', run.public())
    return run


def _schedule(run: Run):
    run.status = 'running'
    events.publish('run', run.public())
    by_id = {st['id']: st for st in run.sc['steps']}
    threads: dict[str, threading.Thread] = {}
    stop_on_error = (run.sc.get('options') or {}).get('stop_on_error', False)
    while True:
        pending = [s for s in run.steps.values() if s.status == 'pending']
        active = [s for s in run.steps.values() if s.status in ('running', 'waiting', 'approval')]
        if not pending and not active:
            break
        if run.cancel.is_set():
            for s in pending:
                s.status = 'cancelled'
                run.emit_step(s)
            if not active:
                break
        for s in pending:
            if run.cancel.is_set():
                break
            dstates = [run.steps[d].status for d in s.after if d in run.steps]
            if any(x in ('error', 'skipped', 'cancelled') for x in dstates):
                bad = [d for d in s.after if run.steps[d].status in ('error', 'skipped', 'cancelled')]
                if not all(by_id[d].get('continue_on_error') for d in bad):
                    s.status = 'skipped'
                    s.message = 'не выполнен шаг ' + ', '.join(bad)
                    run.emit_step(s)
                    continue
            if not all(x in ('done', 'error', 'skipped', 'cancelled') for x in dstates):
                continue
            st = by_id[s.id]
            model, gpu, _ = resolve(st)
            res = _resources(st, model, gpu)
            with _glock:
                if any(r in _global_locks for r in res):
                    if s.status != 'waiting' and s.message != 'ждёт ресурс':
                        s.message = 'ждёт ' + ', '.join(r for r in res if r in _global_locks)
                        run.emit_step(s)
                    continue
                for r in res:
                    _global_locks[r] = f'{run.id}/{s.id}'
            s.status = 'running'
            s.message = ''
            s.model = (model or {}).get('id')
            s.gpu = gpu
            s.started = time.time()
            run.emit_step(s)
            t = threading.Thread(target=_run_step, args=(run, st, s, model, gpu, res), daemon=True)
            threads[s.id] = t
            t.start()
        if stop_on_error and any(s.status == 'error' for s in run.steps.values()):
            run.cancel.set()
        time.sleep(0.2)
    states = [s.status for s in run.steps.values()]
    run.status = ('cancelled' if run.cancel.is_set() else
                  'error' if 'error' in states else 'partial' if 'skipped' in states else 'done')
    run.finished = time.time()
    run.save(True)
    events.publish('run', run.public())


def _run_step(run: Run, st: dict, s: StepState, model, gpu, res: set):
    try:
        fn = ADAPTERS.get(st['uses'])
        if not fn:
            raise RuntimeError(f'нет исполнителя для uses: {st["uses"]}')
        ctx = StepCtx(run, st, s, model, gpu)
        units = script.units(run.sc, st, (model or {}).get('defaults'))
        s.total = len(units)
        run.emit_step(s)
        fn(ctx, units)
        s.status = 'done'
        s.done = max(s.done, s.total)
    except Cancelled:
        s.status = 'cancelled'
    except Exception as e:  # noqa: BLE001
        if run.cancel.is_set():
            s.status = 'cancelled'
        else:
            s.status = 'error'
            s.error = str(e)
            s.log.append('ОШИБКА: ' + str(e))
            s.log.extend(traceback.format_exc().splitlines()[-6:])
    finally:
        s.finished = time.time()
        with _glock:
            for r in res:
                if _global_locks.get(r) == f'{run.id}/{s.id}':
                    del _global_locks[r]
        run.emit_step(s)
        run.save(True)


def cancel(run_id: str):
    run = RUNS.get(run_id)
    if not run:
        return
    run.cancel.set()
    for ev in run.approvals.values():
        ev.set()
    from . import services
    for p in list(run.procs):
        try:
            services.kill_tree(p.pid)
        except Exception:  # noqa: BLE001
            pass
    events.publish('run', run.public())


def approve(run_id: str, step_id: str, selected: list):
    run = RUNS[run_id]
    run.selected[step_id] = selected
    ev = run.approvals.get(step_id)
    if ev:
        ev.set()


def load_history():
    """Прошлые запуски — для списка (только просмотр)."""
    out = []
    if RUNS_DIR.exists():
        for p in sorted(RUNS_DIR.glob('*.json'), reverse=True)[:100]:
            if p.stem in RUNS:
                continue
            try:
                d = json.loads(p.read_text(encoding='utf-8'))
                if d.get('status') in ('running', 'queued'):
                    d['status'] = 'interrupted'
                out.append(d)
            except ValueError:
                pass
    return out


def get_public(run_id: str) -> dict | None:
    if run_id in RUNS:
        return RUNS[run_id].public(True)
    p = RUNS_DIR / f'{run_id}.json'
    if p.exists():
        d = json.loads(p.read_text(encoding='utf-8'))
        if d.get('status') in ('running', 'queued'):
            d['status'] = 'interrupted'
        return d
    return None
