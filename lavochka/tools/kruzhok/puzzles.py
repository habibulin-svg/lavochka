"""Задачи для шахматного кружка — выборка из открытой базы Lichess (CC0, database.lichess.org/#puzzles).

Запуск: python tools/kruzhok/puzzles.py D:/temp/kruzhok/puzzles.csv.zst
Берём популярные и много раз решённые задачи с устоявшимся рейтингом — равномерно по темам и по рейтингу
(полосы по 100 очков), чтобы и в учебнике, и в решалке было из чего выбрать. Результат — public/kruzhok/puzzles.json:
{ "src": ..., "p": [[id, fen, ходы UCI через пробел, рейтинг, "темы через пробел"], ...] } по возрастанию рейтинга.
FEN — позиция до хода соперника: первый ход в списке делает соперник, дальше решает игрок.
Нужен пакет zstandard (pip install zstandard)."""
import io, json, sys, os
import zstandard

# темы, ради которых собираем; у каждой — сколько задач на полосу рейтинга
THEMES = {
    'mateIn1': 14, 'mateIn2': 14, 'mateIn3': 10, 'mateIn4': 5, 'mateIn5': 3,
    'backRankMate': 6, 'smotheredMate': 6, 'anastasiaMate': 4, 'arabianMate': 4, 'bodenMate': 4,
    'doubleBishopMate': 4, 'dovetailMate': 4, 'hookMate': 4, 'killBoxMate': 3, 'vukovicMate': 3,
    'fork': 10, 'pin': 10, 'skewer': 8, 'discoveredAttack': 8, 'doubleCheck': 6, 'xRayAttack': 5,
    'deflection': 8, 'attraction': 8, 'clearance': 5, 'interference': 5, 'intermezzo': 5,
    'sacrifice': 8, 'hangingPiece': 8, 'trappedPiece': 6, 'capturingDefender': 6, 'exposedKing': 5,
    'kingsideAttack': 5, 'queensideAttack': 3, 'quietMove': 5, 'defensiveMove': 6, 'zugzwang': 5,
    'promotion': 6, 'underPromotion': 3, 'advancedPawn': 5, 'enPassant': 3, 'castling': 2,
    'pawnEndgame': 6, 'rookEndgame': 6, 'queenEndgame': 4, 'bishopEndgame': 4, 'knightEndgame': 4,
    'queenRookEndgame': 3, 'opening': 5, 'middlegame': 3, 'endgame': 3, 'equality': 3,
}
LO, HI, STEP = 400, 2800, 100


def main(path):
    out = {}
    count = {}
    f = open(path, 'rb')
    r = io.TextIOWrapper(zstandard.ZstdDecompressor(max_window_size=2**31).stream_reader(f), encoding='utf-8')
    r.readline()
    seen = 0
    for line in r:
        seen += 1
        c = line.rstrip('\n').split(',')
        pid, fen, moves, rating, rd, pop, plays, themes = c[0], c[1], c[2], int(c[3]), int(c[4]), int(c[5]), int(c[6]), c[7]
        if rd > 90 or pop < 88 or plays < 800 or not (LO <= rating < HI):
            continue
        band = (rating - LO) // STEP
        th = themes.split()
        for t in th:
            cap = THEMES.get(t)
            if not cap:
                continue
            k = (t, band)
            if count.get(k, 0) >= cap:
                continue
            count[k] = count.get(k, 0) + 1
            out[pid] = [pid, fen, moves, rating, themes]
            break
    p = sorted(out.values(), key=lambda x: x[3])
    dst = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'kruzhok', 'puzzles.json')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, 'w', encoding='utf-8') as w:
        json.dump({'src': 'Lichess puzzle database, CC0 — database.lichess.org', 'p': p}, w, ensure_ascii=False, separators=(',', ':'))
    per = {}
    for x in p:
        for t in x[4].split():
            per[t] = per.get(t, 0) + 1
    print(f'просмотрено {seen}, отобрано {len(p)}, файл {os.path.getsize(dst) // 1024} КБ')
    print(' '.join(f'{t}:{per.get(t, 0)}' for t in THEMES))


if __name__ == '__main__':
    main(sys.argv[1])
