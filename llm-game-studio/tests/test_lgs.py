"""Тесты студии без видеокарты: формат, развёртка единиц, подбор, запуск шагов, LLM-шаги на поддельном llama-server.

python -m unittest discover -s llm-game-studio/tests
"""
import json
import pathlib
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lgs import advisor, catalog, config, download, runner, script, services  # noqa: E402
from lgs import steps_comfy, steps_llm, steps_proc  # noqa: E402,F401

config.load()
TMP = pathlib.Path(tempfile.mkdtemp(prefix='lgs-test-'))
config.CFG['out_dir'] = str(TMP / 'out')
runner.RUNS_DIR = TMP / 'runs'   # история запусков тестов — не в data/ студии
PY = sys.executable.replace('\\', '/')


def wait_run(r, approve=None, timeout=60):
    t0 = time.time()
    while r.status in ('queued', 'running') and time.time() - t0 < timeout:
        if approve:
            for sid, pick in approve.items():
                if r.steps[sid].status == 'approval':
                    runner.approve(r.id, sid, pick(r))
        time.sleep(0.1)
    return r


class FormatTest(unittest.TestCase):
    def test_errors(self):
        errs = script.validate({'lgs': 2, 'name': 'плохо', 'steps': [{'id': 'a', 'uses': 'nope', 'after': 'b'}]})
        joined = ' '.join(errs)
        for frag in ('lgs: 1', 'name', 'uses', 'after «b»'):
            self.assertIn(frag, joined)

    def test_unknown_step_key_is_warning(self):
        sc = {'lgs': 1, 'name': 'x', 'steps': [{'id': 'a', 'uses': 'image', 'width': 512, 'prompt': 'p'}]}
        errs, warns = script.check(sc)
        self.assertEqual(errs, [])
        self.assertTrue(any('width' in w for w in warns))
        self.assertEqual(script.units(sc, sc['steps'][0])[0]['width'], 512)

    def test_parse_from_llm_answer(self):
        sc = script.parse('Вот скрипт:\n```yaml\nlgs: 1\nname: a\nsteps:\n  - id: s\n    uses: shell\n    run: echo 1\n```\nУдачи!')
        self.assertEqual(sc['name'], 'a')

    def test_units_and_subst(self):
        sc = {'lgs': 1, 'name': 'u', 'vars': {'style': 'flat'}, 'steps': [
            {'id': 'art', 'uses': 'image', 'seeds': [1, 2], 'with': {'prompt': '${subject}, ${style}', 'width': 640},
             'items': [{'name': 'a', 'subject': 'apple'}, {'name': 'b', 'subject': 'bench', 'width': 800}]}]}
        us = script.units(sc, sc['steps'][0], {'width': 1024, 'steps': 8})
        self.assertEqual([u['key'] for u in us], ['a-1', 'a-2', 'b-1', 'b-2'])
        self.assertEqual(us[0]['prompt'], 'apple, flat')
        self.assertEqual((us[0]['width'], us[2]['width'], us[0]['steps']), (640, 800, 8))

    def test_items_from_llm_results(self):
        d = TMP / 'ifr'
        d.mkdir(parents=True, exist_ok=True)
        (d / 'results.json').write_text(json.dumps([{'name': 'ideas', 'json': {'items': [{'name': 'Жвачка Love is', 'x': 1}, {'y': 2}]}}]), encoding='utf-8')
        items = script.load_items(str(d / 'results.json'))
        self.assertEqual(items[0]['name'], 'Love-is')   # кириллица из имени вычищена до латиницы
        self.assertEqual(items[1]['name'], 'ideas-2')

    def test_implicit_dependency(self):
        st = {'id': 'cut', 'uses': 'cutout', 'inputs': '${steps.art.dir}/*.png'}
        self.assertEqual(script.deps(st), ['art'])

    def test_examples_valid(self):
        for p in (ROOT / 'examples').glob('*.yaml'):
            sc, _ = script.load_file(str(p))
            self.assertEqual(script.validate(sc), [], p.name)
        # и примеры из описания формата
        doc = (ROOT / 'SCRIPT_FORMAT.md').read_text(encoding='utf-8')
        import re
        for block in re.findall(r'```yaml\n(lgs: 1.*?)```', doc, re.S):
            if 'steps: [...]' in block:      # шапка-образец без шагов
                continue
            self.assertEqual(script.validate(script.parse(block)), [], block[:60])


class AdvisorTest(unittest.TestCase):
    HW = {'gpus': [{'index': 0, 'name': 'RTX 4070', 'vram_gb': 12, 'free_gb': 11, 'bandwidth': 504},
                   {'index': 1, 'name': 'RTX 5060', 'vram_gb': 8, 'free_gb': 7.5, 'bandwidth': 448}],
          'ram': {'total_gb': 32}}

    def test_quant_match(self):
        self.assertTrue(download.has_quant('M-UD-Q4_K_XL.gguf', 'UD-Q4_K_XL'))
        self.assertFalse(download.has_quant('M-UD-Q4_K_XL.gguf', 'Q4_K_M'))
        self.assertFalse(download.has_quant('M-Q4_K_S.gguf', 'Q4_K_M'))

    def test_llm_plan_two_gpus(self):
        m = {'id': 'x', 'title': 'X', 'params_b': 27, 'active_b': 27, 'ctx_max': 131072, 'quality': 9}
        p = advisor.plan_llm(m, {'quant': 'Q4_K_M', 'size_gb': 16.5, 'installed': True, 'path': 'x.gguf', 'info': None},
                             self.HW['gpus'], 32, 16384)
        self.assertEqual(p['cpu_gb'], 0)                      # 16,5 ГБ на 12+8 — целиком на картах
        self.assertIn('-ts', p['args'])
        self.assertGreater(p['tps'], 10)
        one = advisor.plan_llm(m, {'quant': 'Q4_K_M', 'size_gb': 16.5, 'installed': True, 'path': 'x', 'info': None},
                               [self.HW['gpus'][1]], 32, 16384)
        self.assertIsNone(one)                                 # плотная 27B на 8 ГБ — не пускаем

    def test_moe_offload(self):
        m = {'id': 'm', 'title': 'M', 'params_b': 35, 'active_b': 3, 'moe': True, 'ctx_max': 65536, 'quality': 8}
        p = advisor.plan_llm(m, {'quant': 'IQ4_XS', 'size_gb': 17, 'installed': True, 'path': 'm', 'info': {'layers': 41}},
                             [self.HW['gpus'][1]], 32, 16384)
        self.assertGreater(p['cpu_gb'], 0)
        self.assertIn('--n-cpu-moe', p['args'])

    def test_recommend(self):
        rec = advisor.recommend(self.HW)
        self.assertEqual(rec['image']['gpu'], 0)               # тяжёлое — на большую
        self.assertEqual(rec['cutout']['gpu'], 1)              # лёгкое — на малую

    def test_gguf_real_file(self):
        f = next((x for x in pathlib.Path(config.CFG['llm_dir']).glob('*.gguf') if 'mmproj' not in x.name.lower()), None) if pathlib.Path(config.CFG['llm_dir']).is_dir() else None
        if not f:
            self.skipTest('нет GGUF на диске')
        info = catalog.gguf_info(str(f))
        self.assertGreater(info['layers'], 0)


class RunTest(unittest.TestCase):
    def test_parallel_approve_and_report(self):
        sc, text = script.load_file(str(ROOT / 'examples' / 'demo-no-gpu.yaml'))
        sc['vars']['count'] = 2
        r = wait_run(runner.start(sc, text), {'pick': lambda r: [r.steps['trees'].outputs[0]['path']]})
        self.assertEqual(r.status, 'done', {k: (v.status, v.error) for k, v in r.steps.items()})
        sel = json.loads((script.step_dir(sc, sc['steps'][2]) / 'selected.json').read_text(encoding='utf-8'))
        self.assertEqual(len(sel), 1)
        self.assertEqual(len(r.steps['trees'].outputs), 2)

    def test_failed_step_skips_dependents(self):
        sc = {'lgs': 1, 'name': 'fail', 'steps': [
            {'id': 'a', 'uses': 'shell', 'run': 'exit 3'},
            {'id': 'b', 'uses': 'shell', 'after': 'a', 'run': 'echo b'},
            {'id': 'c', 'uses': 'shell', 'run': 'echo c'}]}
        r = wait_run(runner.start(sc, ''))
        self.assertEqual([r.steps[x].status for x in 'abc'], ['error', 'skipped', 'done'])

    def test_resume_skips_done(self):
        sc = {'lgs': 1, 'name': 'resume', 'steps': [{'id': 'p', 'uses': 'python', 'script': f'{ROOT.as_posix()}/examples/demo_art.py', 'args': ['r', 1]}]}
        wait_run(runner.start(sc, ''))
        man = json.loads((script.step_dir(sc, sc['steps'][0]) / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(man[0]['kind'], 'image')


class _FakeLLM(BaseHTTPRequestHandler):
    replies: list = []

    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        _FakeLLM.last = body
        text = _FakeLLM.replies.pop(0) if _FakeLLM.replies else 'ok'
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        for i in range(0, len(text), 7):
            self.wfile.write(f'data: {json.dumps({"choices": [{"delta": {"content": text[i:i + 7]}}]})}\n\n'.encode())
        self.wfile.write(b'data: [DONE]\n\n')


class LLMStepTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(('127.0.0.1', 0), _FakeLLM)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.old_port = config.CFG['ports']['llm']
        config.CFG['ports']['llm'] = cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        config.CFG['ports']['llm'] = cls.old_port
        cls.srv.shutdown()

    def test_llm_json_to_items(self):
        _FakeLLM.replies = ['<think>хм</think>{"items": [{"name": "gum", "subject": "bubble gum"}, {"name": "cola", "subject": "cola"}]}']
        sc = {'lgs': 1, 'name': 'llmj', 'steps': [
            {'id': 'ideas', 'uses': 'llm', 'json': True, 'prompt': 'идеи'},
            {'id': 'echo', 'uses': 'shell', 'items_from': '${steps.ideas.dir}/results.json', 'run': 'echo ${subject}'}]}
        r = wait_run(runner.start(sc, ''))
        self.assertEqual(r.status, 'done', {k: (v.status, v.error) for k, v in r.steps.items()})
        self.assertEqual(_FakeLLM.last['response_format']['type'], 'json_object')
        self.assertEqual(r.steps['echo'].total, 2)
        self.assertIn('bubble gum', '\n'.join(r.steps['echo'].log))

    def test_code_loop_fixes_after_failed_test(self):
        work = TMP / 'code'
        work.mkdir(parents=True, exist_ok=True)
        _FakeLLM.replies = ['```python path=add.py\ndef add(a, b):\n    return a - b\n```',
                            '```python path=add.py\ndef add(a, b):\n    return a + b\n```']
        sc = {'lgs': 1, 'name': 'code', 'steps': [{'id': 'c', 'uses': 'code', 'workdir': str(work), 'files': ['add.py'],
                                                  'task': 'функция add', 'max_iters': 3,
                                                  'test': f'"{PY}" -c "from add import add; assert add(2, 3) == 5"'}]}
        r = wait_run(runner.start(sc, ''))
        self.assertEqual(r.status, 'done', r.steps['c'].error)
        self.assertIn('a + b', (work / 'add.py').read_text(encoding='utf-8'))
        self.assertIn('Попытка 2: тест пройден', (script.step_dir(sc, sc['steps'][0]) / 'report.md').read_text(encoding='utf-8'))

    def test_code_restores_on_fail(self):
        work = TMP / 'code2'
        work.mkdir(parents=True, exist_ok=True)
        (work / 'm.py').write_text('X = 1\n', encoding='utf-8')
        _FakeLLM.replies = ['```python path=m.py\nX = 2\n```', '```python path=../evil.py\nboom\n```']
        sc = {'lgs': 1, 'name': 'code2', 'steps': [{'id': 'c', 'uses': 'code', 'workdir': str(work), 'files': ['*.py'],
                                                   'task': 't', 'max_iters': 2, 'test': 'exit 1'}]}
        r = wait_run(runner.start(sc, ''))
        self.assertEqual(r.steps['c'].status, 'error')
        self.assertEqual((work / 'm.py').read_text(encoding='utf-8'), 'X = 1\n')   # вернули как было
        self.assertFalse((TMP / 'evil.py').exists())                               # за пределы workdir не пишет


if __name__ == '__main__':
    unittest.main()
