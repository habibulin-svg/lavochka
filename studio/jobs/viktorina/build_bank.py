"""Викторина: сырые вопросы studio/jobs/viktorina/raw/*.json (пишут агенты, формат — SPEC.md) → банк игры
lavochka/src/games/viktorina/bank/{mc,word,poll,board}.json.

python studio/jobs/viktorina/build_bank.py [--strict]

Что делает:
- читает все raw/<формат>-*.json (формат — по началу имени файла: mc, word, poll, board); битый JSON — файл пропускается с отчётом;
- нормализует (пробелы, кавычки, «ё» в слове → «Е», прописные в слове);
- проверяет каждую запись по SPEC.md и отбраковывает кривые с причиной;
- выкидывает дубли (нормализованный текст вопроса / слово / тема) — остаётся первая встреченная;
- применяет вердикты проверки фактов check/<имя файла raw>.json (CHECK.md): drop — выкинуть, fix — заменить на rec
  (rec проходит ту же проверку формата); i — номер записи в файле с нуля (у board — номер темы);
- выкидывает помеченные вручную: поле "x" (или "bad") в записи, или id/текст вопроса в reject.txt рядом
  (по строке: id из банка, либо текст вопроса как есть; # — комментарий);
- даёт каждой записи стабильный id — по нормализованному ключу (не зависит от порядка файлов: правка соседей номер не меняет);
- печатает сводку и пишет подробный отчёт в G:/temp/studio/out/viktorina/bank-report.txt.

--strict: предупреждения (длинновато, сумма опроса чуть мимо) тоже браковать.
Файлы в raw/ скрипт только читает.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
RAW = HERE / 'raw'
REJECT = HERE / 'reject.txt'
CHECKS = pathlib.Path(__import__('os').environ.get('VIKTORINA_CHECK') or HERE / 'check')
DST = HERE.parents[2] / 'lavochka/src/games/viktorina/bank'
REPORT = pathlib.Path('G:/temp/studio/out/viktorina/bank-report.txt')

TOPICS = ['history', 'geo', 'lit', 'lang', 'cinema', 'cartoons', 'music', 'sport', 'science', 'nature', 'human', 'space', 'art', 'tech', 'food', 'ussr', 'myth', 'misc']
FORMATS = ['mc', 'word', 'poll', 'board']
BAD_OPTS = re.compile(r'(все перечисленн|ни один из|все ответы|нет правильного|оба варианта)', re.I)
QUOTES = str.maketrans({'“': '«', '”': '»', '„': '«', '\u00a0': ' ', '\u2009': ' '})


def clean(s) -> str:
    if not isinstance(s, str):
        return ''
    s = s.translate(QUOTES)
    s = re.sub(r'\s+', ' ', s).strip()
    # "слово" → «слово»
    s = re.sub(r'"([^"]+)"', r'«\1»', s)
    return s


def key(s: str) -> str:
    """Ключ для дублей и сверки: строчные, ё→е, только буквы и цифры."""
    s = s.lower().replace('ё', 'е')
    return re.sub(r'[^0-9a-zа-я]+', ' ', s).strip()


def sid(fmt: str, k: str) -> str:
    return fmt[0] + hashlib.sha1(f'{fmt}|{k}'.encode('utf-8')).hexdigest()[:7]


class Bad(Exception):
    pass


class Report:
    def __init__(self, strict: bool):
        self.strict = strict
        self.lines: list[str] = []
        self.count = collections.Counter()

    def warn(self, why: str):
        if self.strict:
            raise Bad(why + ' (--strict)')
        self.count['предупреждение: ' + why.split(':')[0]] += 1


def check_mc(r: dict, rep: Report) -> dict:
    q = clean(r.get('q'))
    a = r.get('a')
    if not (10 <= len(q) <= 220):
        raise Bad(f'длина вопроса {len(q)}')
    if len(q) > 160:
        rep.warn(f'вопрос длиннее 160: {len(q)}')
    if not isinstance(a, list) or len(a) != 4:
        raise Bad('вариантов не 4')
    a = [clean(x) for x in a]
    if any(not x for x in a):
        raise Bad('пустой вариант')
    if len({key(x) for x in a}) != 4:
        raise Bad('варианты повторяются')
    if any(len(x) > 60 for x in a):
        raise Bad('вариант длиннее 60')
    if any(len(x) > 40 for x in a):
        rep.warn('вариант длиннее 40')
    if any(BAD_OPTS.search(x) for x in a):
        raise Bad('«все перечисленные» / «ни один»')
    d = r.get('d')
    if not isinstance(d, int) or not 1 <= d <= 5:
        raise Bad(f'сложность {d!r}')
    t = r.get('t')
    if t not in TOPICS:
        raise Bad(f'тема {t!r}')
    return {'q': q, 'a': a, 'd': d, 't': t}


def root_in(word: str, text: str) -> bool:
    """Слово или однокоренное в подсказке: слово подсказки начинается с основы (длина − 2, от 3 до 5 букв)."""
    w = word.lower()
    n = max(3, min(5, len(w) - 2))
    stem = w[:n]
    return any(t.startswith(stem) for t in key(text).split())


def check_word(r: dict, rep: Report) -> dict:
    w = clean(r.get('w')).upper().replace('Ё', 'Е')
    if not re.fullmatch(r'[А-Я]{4,12}', w):
        raise Bad(f'слово «{w}» — не 4–12 кириллических букв')
    h = clean(r.get('h'))
    if not (25 <= len(h) <= 180):
        raise Bad(f'длина подсказки {len(h)}')
    if not (40 <= len(h) <= 140):
        rep.warn(f'подсказка вне 40–140: {len(h)}')
    if root_in(w, h):
        raise Bad(f'подсказка выдаёт слово «{w}»')
    d = r.get('d')
    if not isinstance(d, int) or not 1 <= d <= 5:
        raise Bad(f'сложность {d!r}')
    t = r.get('t')
    if t not in TOPICS:
        raise Bad(f'тема {t!r}')
    return {'w': w, 'h': h, 'd': d, 't': t}


def check_poll(r: dict, rep: Report) -> dict:
    q = clean(r.get('q'))
    if not (8 <= len(q) <= 160):
        raise Bad(f'длина вопроса {len(q)}')
    rr = r.get('r')
    if not isinstance(rr, list) or len(rr) != 6:
        raise Bad('ответов не 6')
    out = []
    for x in rr:
        if not isinstance(x, list) or len(x) < 2:
            raise Bad('ответ не [текст, число, синонимы]')
        txt = clean(x[0])
        n = x[1]
        alt = x[2] if len(x) > 2 and isinstance(x[2], list) else []
        if not txt or len(txt) > 30:
            raise Bad(f'текст ответа «{txt}»')
        if not isinstance(n, int) or n < 1 or n > 90:
            raise Bad(f'число ответа {n!r}')
        alt = [clean(y) for y in alt if clean(y) and key(clean(y)) != key(txt)]
        out.append([txt, n, list(dict.fromkeys(alt))])
    if len({key(x[0]) for x in out}) != 6:
        raise Bad('ответы повторяются')
    if any(out[i][1] < out[i + 1][1] for i in range(5)):
        out.sort(key=lambda x: -x[1])
        rep.warn('ответы не по убыванию: пересортировано')
    if out[0][1] >= 70:
        raise Bad(f'один очевидный ответ ({out[0][0]} — {out[0][1]}): угадывать нечего')
    s = sum(x[1] for x in out)
    if not (70 <= s <= 100):
        raise Bad(f'сумма {s}')
    if not (90 <= s <= 100):
        rep.warn(f'сумма вне 90–100: {s}')
    # синоним, совпавший с другим ответом, — убрать (иначе ответ засчитается дважды)
    mains = {key(x[0]) for x in out}
    for x in out:
        x[2] = [y for y in x[2] if key(y) not in mains]
    t = r.get('t')
    if t not in TOPICS:
        t = 'misc'
    return {'q': q, 'r': out, 't': t}


def check_board(r: dict, rep: Report) -> dict:
    theme = clean(r.get('theme'))
    if not (3 <= len(theme) <= 40):
        raise Bad(f'название темы «{theme}»')
    t = r.get('t')
    if t not in TOPICS:
        raise Bad(f'тема {t!r}')
    qs = r.get('qs')
    if not isinstance(qs, list) or len(qs) != 5:
        raise Bad('вопросов в теме не 5')
    out = []
    for x in qs:
        if not isinstance(x, dict):
            raise Bad('вопрос темы не объект')
        q = clean(x.get('q'))
        a = clean(x.get('a'))
        if not (8 <= len(q) <= 200):
            raise Bad(f'длина вопроса {len(q)}')
        if not a or len(a) > 40 or len(a.split()) > 5:
            raise Bad(f'ответ «{a}» не короткий')
        alt = [clean(y) for y in (x.get('alt') or []) if isinstance(y, str) and clean(y)]
        alt = [y for y in dict.fromkeys(alt) if key(y) != key(a)]
        out.append({'q': q, 'a': a, 'alt': alt})
    if len({key(x['q']) for x in out}) != 5:
        raise Bad('вопросы темы повторяются')
    return {'theme': theme, 't': t, 'qs': out}


CHECK = {'mc': check_mc, 'word': check_word, 'poll': check_poll, 'board': check_board}


def rec_key(fmt: str, r: dict) -> str:
    if fmt == 'word':
        return key(r['w'])
    if fmt == 'board':
        return key(r['theme']) + '|' + key(r['qs'][0]['q'])
    return key(r['q'])


def load_rejects() -> set[str]:
    out = set()
    if REJECT.exists():
        for line in REJECT.read_text(encoding='utf-8').splitlines():
            line = line.split('#', 1)[0].strip()
            if line:
                out.add(line)
                out.add(key(line))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--strict', action='store_true')
    a = ap.parse_args()
    rep = Report(a.strict)
    rejects = load_rejects()
    bank = {f: [] for f in FORMATS}
    seen = {f: {} for f in FORMATS}
    mc_keys: set[str] = set()
    raw_n = collections.Counter()
    fact_n = collections.Counter()
    checked_files = [0]
    bad_n = collections.Counter()
    files = sorted(RAW.glob('*.json'))
    for p in files:
        fmt = p.name.split('-', 1)[0]
        if fmt not in CHECK:
            rep.lines.append(f'{p.name}: неизвестный формат — пропущен')
            continue
        try:
            data = json.loads(p.read_text(encoding='utf-8-sig'))
        except Exception as e:  # файл ещё пишется или битый
            rep.lines.append(f'{p.name}: НЕ JSON ({e}) — файл пропущен')
            bad_n['файл не JSON'] += 1
            continue
        if not isinstance(data, list):
            rep.lines.append(f'{p.name}: не массив — файл пропущен')
            continue
        # вердикты проверки фактов (CHECK.md): check/<имя>.json — [{i, v: drop|fix, why, rec?}]
        verdict = {}
        cp = CHECKS / p.name
        if cp.exists():
            try:
                for v in json.loads(cp.read_text(encoding='utf-8-sig')):
                    if isinstance(v, dict) and isinstance(v.get('i'), int) and v.get('v') in ('drop', 'fix'):
                        verdict[v['i']] = v
            except Exception as e:
                rep.lines.append(f'check/{p.name}: НЕ JSON ({e}) — вердикты не применены')
                bad_n['вердикты: файл не JSON'] += 1
        checked_files[0] += cp.exists()
        for i, r in enumerate(data):
            v = verdict.get(i)
            if v and v['v'] == 'drop':
                raw_n[fmt] += 1
                fact_n[f'{fmt}: выкинуто'] += 1
                rep.lines.append(f'{p.name}#{i + 1}: выкинуто проверкой — {v.get("why", "")}')
                continue
            if v and v['v'] == 'fix':
                if isinstance(v.get('rec'), dict):
                    r = v['rec']
                    fact_n[f'{fmt}: исправлено'] += 1
                    rep.lines.append(f'{p.name}#{i + 1}: исправлено проверкой — {v.get("why", "")}')
                else:
                    raw_n[fmt] += 1
                    fact_n[f'{fmt}: fix без rec — выкинуто'] += 1
                    continue
            raw_n[fmt] += 1
            where = f'{p.name}#{i + 1}'
            try:
                if not isinstance(r, dict):
                    raise Bad('не объект')
                if r.get('x') or r.get('bad'):
                    raise Bad('помечено проверкой фактов')
                x = CHECK[fmt](r, rep)
                k = rec_key(fmt, x)
                x = {'id': sid(fmt, k), **x}
                if x['id'] in rejects or k in rejects or key(str(r.get('q') or r.get('w') or r.get('theme') or '')) in rejects:
                    raise Bad('в reject.txt')
                if k in seen[fmt]:
                    raise Bad(f'дубль {seen[fmt][k]}')
                if fmt == 'mc':
                    mc_keys.add(k)
                seen[fmt][k] = where
                bank[fmt].append(x)
            except Bad as e:
                why = re.sub(r' [^ ]+\.json#\d+$', '', str(e).split(' «')[0].split(':')[0])
                bad_n[f'{fmt}: {why}'] += 1
                rep.lines.append(f'{where}: {e}')

    # id обязаны быть уникальны (коллизия хеша — почти невозможна, но проверим)
    for fmt in FORMATS:
        ids = collections.Counter(x['id'] for x in bank[fmt])
        dup = [i for i, n in ids.items() if n > 1]
        if dup:
            sys.exit(f'коллизия id в {fmt}: {dup}')
        bank[fmt].sort(key=lambda x: x['id'])

    DST.mkdir(parents=True, exist_ok=True)
    for fmt in FORMATS:
        (DST / f'{fmt}.json').write_text(json.dumps(bank[fmt], ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    summary = ['Банк викторины:']
    for fmt in FORMATS:
        extra = ''
        if fmt in ('mc', 'word'):
            dd = collections.Counter(x['d'] for x in bank[fmt])
            extra = '  по сложности ' + ' '.join(f'{d}:{dd[d]}' for d in range(1, 6))
        summary.append(f'  {fmt:6} сырых {raw_n[fmt]:5}  в банке {len(bank[fmt]):5}  отбраковано {raw_n[fmt] - len(bank[fmt]):4}{extra}')
    tt = collections.Counter(x['t'] for x in bank['mc'])
    summary.append('  mc по темам: ' + ', '.join(f'{t} {tt[t]}' for t in TOPICS if tt[t]))
    summary.append(f'Проверка фактов: файлов с вердиктами {checked_files[0]}' + (': ' + ', '.join(f'{k} {n}' for k, n in sorted(fact_n.items())) if fact_n else ''))
    summary.append('Отбраковка по причинам:')
    for k, n in sorted(bad_n.items(), key=lambda kv: -kv[1]):
        summary.append(f'  {n:4}  {k}')
    warn = {k: n for k, n in rep.count.items()}
    if warn:
        summary.append('Предупреждения (в банк вошли; --strict их тоже бракует):')
        for k, n in sorted(warn.items(), key=lambda kv: -kv[1]):
            summary.append(f'  {n:4}  {k}')
    text = '\n'.join(summary)
    print(text)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(text + '\n\nПодробно:\n' + '\n'.join(rep.lines) + '\n', encoding='utf-8')
    print(f'Подробный отчёт: {REPORT}')


if __name__ == '__main__':
    main()
