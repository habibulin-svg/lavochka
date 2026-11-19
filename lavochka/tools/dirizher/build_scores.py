"""Симулятор дирижёра: собрать отрывки репертуара → public/dirizher/scores/<id>.json.

python tools/dirizher/build_scores.py [<папка .mxl>]   (по умолчанию G:/temp/dirizher/mxl — OpenScore Orchestra, CC0,
github.com/MarkGotham/Hauptstimme, data/…/*.mxl). Список — здесь; названия и описания для игры — src/dirizher/core/pieces.ts
(тест сверяет, что у каждой пьесы есть файл). Такты — по развёртке повторов (tools/dirizher/bars.py показывает, кто где играет);
множитель темпа — где темп в файле MuseScore не тот (Гайдн, Шуберт, Брамс 3/III).
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else 'G:/temp/dirizher/mxl'
OUT = os.path.join(HERE, '..', '..', 'public', 'dirizher', 'scores')

# id, файл, такты, множитель темпа, название, композитор
PIECES = [
    ('ode', 'Beethoven_Op.125_4', '92-187', 1, 'Симфония № 9, финал: «Ода к радости»', 'Людвиг ван Бетховен'),
    ('b7-2', 'Beethoven_Op.92_2', '1-100', 1, 'Симфония № 7, II. Allegretto', 'Людвиг ван Бетховен'),
    ('b5-1', 'Beethoven_Op.67_1', '1-124', 1, 'Симфония № 5, I. Allegro con brio', 'Людвиг ван Бетховен'),
    ('b1-3', 'Beethoven_Op.21_3', '', 1, 'Симфония № 1, III. Менуэт', 'Людвиг ван Бетховен'),
    ('b6-4', 'Beethoven_Op.68_4', '', 1, 'Симфония № 6 «Пасторальная», IV. Гроза', 'Людвиг ван Бетховен'),
    ('b8-2', 'Beethoven_Op.93_2', '', 1, 'Симфония № 8, II. Allegretto scherzando', 'Людвиг ван Бетховен'),
    ('s5-1', 'Schubert_D.485_1', '1-66', 1.55, 'Симфония № 5, I. Allegro', 'Франц Шуберт'),
    ('h104', 'Haydn_104_1', '1-66', 1.45, 'Симфония № 104 «Лондонская», I', 'Йозеф Гайдн'),
    ('b5-4', 'Beethoven_Op.67_4', '1-85', 1, 'Симфония № 5, финал', 'Людвиг ван Бетховен'),
    ('br3-3', 'Brahms_Op.90_3', '1-53', 0.42, 'Симфония № 3, III. Poco allegretto', 'Иоганнес Брамс'),
    ('b9-2', 'Beethoven_Op.125_2', '1-150', 1, 'Симфония № 9, II. Скерцо', 'Людвиг ван Бетховен'),
    ('br1-4', 'Brahms_Op.68_4', '62-118', 1, 'Симфония № 1, финал: главная тема', 'Иоганнес Брамс'),
    ('b7-4', 'Beethoven_Op.92_4', '1-123', 1, 'Симфония № 7, финал', 'Людвиг ван Бетховен'),
    ('b3-1', 'Beethoven_Op.55_1', '1-155', 1, 'Симфония № 3 «Героическая», I', 'Людвиг ван Бетховен'),
    ('br4-1', 'Brahms_Op.98_1', '1-57', 1, 'Симфония № 4, I. Allegro non troppo', 'Иоганнес Брамс'),
    ('b5-1f', 'Beethoven_Op.67_1', '', 1, 'Симфония № 5, I (целиком)', 'Людвиг ван Бетховен'),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[2:])
    for pid, src, bars, k, title, comp in PIECES:
        if only and pid not in only:
            continue
        cmd = [sys.executable, os.path.join(HERE, 'score.py'), os.path.join(SRC, src + '.mxl'), os.path.join(OUT, pid + '.json'),
               '--id', pid, '--title', title, '--composer', comp]
        if bars:
            cmd += ['--bars', bars]
        if k != 1:
            cmd += ['--tempo', str(k)]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf8')
        print(r.stdout.strip() or r.stderr.strip()[-400:])


if __name__ == '__main__':
    main()
