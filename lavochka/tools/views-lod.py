"""Правка видов: убрать узловые точки с карт и сделать загрузку поля из размытия, как в «Кинь-двине».

Что делает:
 1) в видах «Звезды Африки», «Джио-Джанги» и «Беглых» убирает отрисовку кружков-точек графа
    (пользователю они не нужны — на карте и так нарисован путь);
 2) ставит в разметку две картинки поля: крошечную (размытую) и полную, которая проявляется
    по загрузке (класс ready уже ставится видом).

Запуск из lavochka/:  python -I tools/views-lod.py
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

JOBS = [
    {
        'view': os.path.join(ROOT, 'src', 'games', 'star', 'view.ts'),
        'css': os.path.join(ROOT, 'src', 'games', 'star', 'star.css'),
        'cls': 'st',
        'field': '/star/field.webp',
        'small': '/star/field-small.webp',
        'alt': 'Карта Африки',
    },
    {
        'view': os.path.join(ROOT, 'src', 'games', 'djio', 'view.ts'),
        'css': os.path.join(ROOT, 'src', 'games', 'djio', 'djio.css'),
        'cls': 'dj',
        'field': '/djio/field.webp',
        'small': '/djio/field-small.webp',
        'alt': 'Поле Джио-Джанги',
    },
    {
        'view': os.path.join(ROOT, 'src', 'games', 'beglye', 'view.ts'),
        'css': os.path.join(ROOT, 'src', 'games', 'beglye', 'beglye.css'),
        'cls': 'bg',
        'field': '/beglye/field.webp',
        'small': '/beglye/field-small.webp',
        'alt': 'Карта',
    },
]


def patch_view(job):
    path = job['view']
    s = io.open(path, encoding='utf8').read()
    cls = job['cls']
    # 1) разметка: две картинки вместо одной
    img_re = re.compile(r'<img class="%s-map" src="([^"]+)" alt="([^"]*)" draggable="false">' % cls)
    m = img_re.search(s)
    if m:
        s = s[:m.start()] + (
            '<img class="%s-map %s-map-mini" src="%s" alt="" draggable="false">'
            '<img class="%s-map %s-map-full" src="%s" alt="%s" draggable="false">' % (cls, cls, job['small'], cls, cls, job['field'], job['alt'])
        ) + s[m.end():]
    # 2) убрать отрисовку кружков-точек: строки с append(... 'X-dot' ...)
    before = s
    s = re.sub(r'\n\s*over!?\.append\(\s*\n?\s*svg\(\'circle\', \{[^;]*?\'%s-dot[^;]*?\}\s*\)\s*\n?\s*\);' % cls, '', s, flags=re.S)
    # 3) убрать кольца опасных клеток у «Джио-Джанги»
    if cls == 'dj':
        s = re.sub(r'\n\s*over\.append\(svg\(\'circle\', \{[^;]*?\'dj-danger\'[^;]*?\}\)\);', '', s, flags=re.S)
        s = re.sub(r'\n\s*// дикие звери[^\n]*\n\s*for \(let i = 0; i < CELLS\.length; i\+\+\) \{\n\s*if \(!LAIR_OF\[i\]\) continue;\n\s*const c = CELLS\[i\];\n\s*over\.append\([^;]*?\);\n\s*\}', '', s, flags=re.S)
    # 4) у «Звезды Африки» кружок точки рисуется отдельным append с классом st-dot
    if cls == 'st':
        s = re.sub(r'\n\s*over\.append\(\s*\n\s*svg\(\'circle\', \{\s*\n[^;]*?class: `st-dot[^;]*?\}\s*\)\s*\n\s*\);', '', s, flags=re.S)
    io.open(path, 'w', encoding='utf8').write(s)
    return (before != s), path


def patch_css(job):
    path = job['css']
    s = io.open(path, encoding='utf8').read()
    cls = job['cls']
    if '%s-map-mini' % cls in s:
        return False, path
    s += (
        '\n/* поле грузится из размытия: пока полная картинка едет, видна крошечная копия */\n'
        '.%s-board { position: relative; }\n'
        '.%s-map-mini { position: absolute; inset: 0; width: 100%%; height: 100%%; filter: blur(7px) saturate(1.1); transform: scale(1.05); transition: opacity .45s ease; }\n'
        '.%s-map-full { position: relative; opacity: 0; transition: opacity .45s ease; }\n'
        '.%s-board.ready .%s-map-full { opacity: 1; }\n'
        '.%s-board.ready .%s-map-mini { opacity: 0; }\n'
    ) % (cls, cls, cls, cls, cls, cls, cls)
    io.open(path, 'w', encoding='utf8').write(s)
    return True, path


def main():
    for job in JOBS:
        changed, path = patch_view(job)
        css_changed, css_path = patch_css(job)
        print('%s: вид %s, стили %s' % (job['cls'], 'правлен' if changed else 'без изменений', 'правлены' if css_changed else 'без изменений'))


if __name__ == '__main__':
    main()
