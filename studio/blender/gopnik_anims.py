"""Анимации гопника: позы по кадрам (без bpy — данные для gopnik_sprites.py).

Поза — словарь:
  кость: угол в градусах или (вперёд, кручение, наружу). Руки и ноги (кость вниз): 0 — висит, 90 — вперёд,
         180 — вверх, −90 — назад; предплечье + — сгиб в локте вперёд; бедро + — колено вперёд, голень − — сгиб назад.
         Корпус и голова (кость вверх): + — наклон вперёд (голова: + — смотрит вниз).
  lean  — добавка к наклону корпуса (spine);
  rot   — поворот всего тела в плоскости кадра, + — вперёд (по часовой), вокруг точки pivot (доля роста, 0.5);
  yaw   — поворот вокруг вертикали (разворот к зрителю), градусы;
  z, fwd — сдвиг тела вверх и вперёд в долях роста; scale — число или (вглубь, вверх, вперёд), от pivot;
  only / hide — какие слоты (cap, head, jacket, trousers, shoes) рисовать / прятать; ice — ледяной брусок.
Персонаж смотрит вправо, рука к камере — правая (.R): её точка идёт в meta.json как hand (для оружия).

Анимация: {'fps', 'loop', 'frames': [поза, …]}. Циклы — 8–12 кадров, разовые — 6–16; aim/aim-pistol —
19 неподвижных кадров по углу прицела −90…+90 через 10°, кадр выбирает игра.
"""
import math

DISCRETE = {'only', 'hide', 'ice'}
DEFAULT = {'scale': 1.0, 'pivot': 0.5}
IDLE = {'head': 3, 'lean': 6, 'forearm.R': 8, 'forearm.L': 8}


def _vec(k, v):
    if isinstance(v, (tuple, list)):
        return tuple(v)
    return (v, v, v) if k == 'scale' else (v, 0, 0)


def blend(p, q, t):
    """Поза между p и q (t от 0 до 1)."""
    out = {}
    for k in set(p) | set(q):
        if k in DISCRETE:
            v = (p if t < 0.5 else q).get(k)
            if v is not None:
                out[k] = v
            continue
        a, b = p.get(k, DEFAULT.get(k, 0)), q.get(k, DEFAULT.get(k, 0))
        if isinstance(a, (tuple, list)) or isinstance(b, (tuple, list)):
            a, b = _vec(k, a), _vec(k, b)
            out[k] = tuple(x + (y - x) * t for x, y in zip(a, b))
        else:
            out[k] = a + (b - a) * t
    return out


def smooth(u):
    return u * u * (3 - 2 * u)


def tween(n, keys, loop=False, ease=True):
    """keys: [(кадр, поза), …] → n поз. В цикле последний ключ сводится к первому (кадр n не рисуется).
    Третий элемент ключа 'lin' — участок после него без сглаживания (быстрые удары)."""
    ks = sorted(keys, key=lambda k: k[0])
    if loop and ks[-1][0] < n:
        ks.append((n, ks[0][1]))
    out = []
    for i in range(n):
        if i <= ks[0][0]:
            out.append(dict(ks[0][1]))
            continue
        if i >= ks[-1][0]:
            out.append(dict(ks[-1][1]))
            continue
        j = max(j for j in range(len(ks)) if ks[j][0] <= i)
        t0, p0 = ks[j][0], ks[j][1]
        t1, p1 = ks[j + 1][0], ks[j + 1][1]
        u = (i - t0) / (t1 - t0)
        lin = len(ks[j]) > 2 and ks[j][2] == 'lin'
        out.append(blend(p0, p1, u if lin or not ease else smooth(u)))
    return out


def cycle(n, f):
    """n кадров цикла: f(фаза 0…2π) → поза."""
    return [f(2 * math.pi * i / n) for i in range(n)]


def plant(p, extra=0.0):
    """Опустить тело так, чтобы нижняя ступня стояла на земле (бедро 0.105, голень 0.09 роста; без rot)."""
    def drop(s):
        t = _vec('', p.get('thigh.' + s, 0))[0]
        sh = _vec('', p.get('shin.' + s, 0))[0]
        return 0.105 * math.cos(math.radians(t)) + 0.09 * math.cos(math.radians(t + sh))
    q = dict(p)
    q['z'] = max(drop('L'), drop('R')) - 0.195 + extra
    return q


def A(fps, loop, frames):
    return {'fps': fps, 'loop': loop, 'frames': frames}


def both(arm=None, fore=None):
    """Обе руки одинаково."""
    d = {}
    if arm is not None:
        d['upper_arm.R'] = d['upper_arm.L'] = arm
    if fore is not None:
        d['forearm.R'] = d['forearm.L'] = fore
    return d


def legs(tr=0, sr=0, tl=0, sl=0):
    return {'thigh.R': tr, 'shin.R': sr, 'thigh.L': tl, 'shin.L': sl}


def P(*parts, **kw):
    """Собрать позу из кусков; кости с точкой в имени — через **{'upper_arm.R': …}."""
    d = {}
    for x in parts:
        d.update(x)
    d.update(kw)
    return d


ANIMS = {}

# ---------------- движение ----------------

# стоит: дышит, голова чуть кивает, сутулится
ANIMS['idle'] = A(8, True, [
    P(IDLE, head=3 + 2 * math.sin(a), z=-0.004 * (1 + math.sin(a)),
      **{'upper_arm.L': -2 * math.sin(a), 'upper_arm.R': -2 * math.sin(a)})
    for a in (2 * math.pi * i / 16 for i in range(16))])

# скучает: зевает и потягивается
ANIMS['bored-yawn'] = A(10, False, tween(14, [
    (0, IDLE),
    (3, P(both((60, 0, 10), 90), head=10, lean=10, z=-0.01)),
    (6, P(both((165, 0, 25), 30), head=-28, lean=-10, z=0.012)),
    (9, P(both((172, 0, 28), 20), head=-32, lean=-12, z=0.016)),
    (11, P(both((120, 0, 20), 60), head=-10, lean=-2)),
    (13, IDLE),
]))

# скучает: чешет кепку
_scr = P(IDLE, head=8, **{'upper_arm.R': (145, 0, 30), 'forearm.R': 105, 'upper_arm.L': -5})
_scr2 = P(_scr, head=12, **{'forearm.R': 125})
ANIMS['bored-scratch'] = A(10, False, tween(12, [
    (0, IDLE), (3, _scr), (4, _scr2), (5, _scr), (6, _scr2), (7, _scr), (8, _scr2), (9, _scr), (11, IDLE),
]))

# скучает: смотрит на часы, вздыхает
_watch = P(IDLE, head=22, lean=10, **{'upper_arm.R': 20, 'forearm.R': 100})
ANIMS['bored-watch'] = A(10, False, tween(12, [
    (0, IDLE),
    (3, _watch),
    (5, P(_watch, **{'upper_arm.R': 25, 'forearm.R': 108})),
    (6, _watch),
    (8, P(_watch, head=-8, lean=2, z=0.008, **{'upper_arm.R': 10, 'forearm.R': 40})),
    (9, P(IDLE, head=-6, lean=0)),
    (11, IDLE),
]))

# идёт: вразвалку
ANIMS['walk'] = A(12, True, [
    P({'thigh.L': 28 * math.sin(a), 'thigh.R': -28 * math.sin(a),
       'shin.L': -35 * max(0, -math.cos(a + 0.6)), 'shin.R': -35 * max(0, math.cos(a + 0.6)),
       'upper_arm.L': -22 * math.sin(a), 'upper_arm.R': 22 * math.sin(a),
       'forearm.L': 15, 'forearm.R': 15},
      head=4 - 2 * abs(math.cos(a)), lean=8, z=0.02 * abs(math.cos(a)) - 0.01)
    for a in (2 * math.pi * i / 12 for i in range(12))])

# прыжок: присел — оттолкнулся — в воздухе — приземлился
_crouch = plant(P(legs(35, -65, 35, -65), both(-25, 20), lean=18, head=-6))
ANIMS['jump'] = A(12, False, [
    _crouch,
    P(legs(-10, -5, -10, -5), both(150, 10), lean=-4, z=0.06, head=-8),
    P(legs(40, -60, 20, -40), both(120, 30), lean=0, z=0.22),
    P(legs(45, -70, 35, -60), both(105, 40), lean=0, z=0.28),
    P(legs(30, -50, 25, -45), both(80, 30), lean=2, z=0.2),
    P(legs(10, -15, 10, -15), both(110, 20), lean=4, z=0.07),
    plant(P(legs(35, -60, 35, -60), both(-25, 20), lean=18)),
    plant(P(legs(10, -15, 10, -15), both(0, 10), lean=8)),
])

# сальто назад: присел — взмах руками — группировка — раскрылся — присед
_tuck = P(legs(115, -135, 105, -130), both(70, 70), head=20, lean=10, pivot=0.45)
ANIMS['backflip'] = A(15, False, [
    _crouch,
    P(legs(-5, -5, -5, -5), both(165, 10), lean=-12, head=-15, z=0.08, rot=-12),
    P(_tuck, rot=-70, z=0.2),
    P(_tuck, rot=-130, z=0.27),
    P(_tuck, rot=-190, z=0.3),
    P(_tuck, rot=-250, z=0.28),
    P(_tuck, rot=-305, z=0.22),
    P(legs(40, -50, 30, -40), both(150, 20), head=0, rot=-345, z=0.12, pivot=0.45),
    P(legs(15, -20, 10, -15), both(120, 10), z=0.04),
    plant(P(legs(40, -70, 40, -70), both(60, 20), lean=20)),
    plant(P(legs(15, -25, 15, -25), both(20, 15), lean=10)),
    IDLE,
])

# падает: машет руками, перебирает ногами, глаза к небу
ANIMS['fall'] = A(12, True, cycle(8, lambda a: P(
    {'upper_arm.R': (140 + 40 * math.sin(a), 0, 25), 'upper_arm.L': (140 - 40 * math.sin(a), 0, 25),
     'forearm.R': 20 + 15 * math.cos(a), 'forearm.L': 20 - 15 * math.cos(a)},
    legs(25 * math.sin(a), -40 - 20 * math.cos(a), -25 * math.sin(a), -40 + 20 * math.cos(a)),
    head=-15, lean=-8, z=0.08)))

# приземление: удар — глубокий присед со сплющиванием — выпрямился
ANIMS['land'] = A(15, False, [
    P(legs(10, -15, 10, -15), both(130, 20), z=0.02),
    plant(P(legs(55, -95, 55, -95), both(60, 30), lean=28, head=10, scale=(1.08, 0.9, 1.08), pivot=0)),
    plant(P(legs(65, -110, 65, -110), both(40, 40), lean=32, head=12, scale=(1.1, 0.86, 1.1), pivot=0)),
    plant(P(legs(35, -60, 35, -60), both(20, 25), lean=18, head=6)),
    plant(P(legs(5, -8, 5, -8), both(-5, 10), lean=4, scale=(0.97, 1.04, 0.97), pivot=0)),
    IDLE,
])

# скользит по склону как на доске: откинулся назад, руки в стороны, покачивается
ANIMS['slide'] = A(10, True, cycle(8, lambda a: plant(P(
    legs(35, -45, -10, -35),
    {'upper_arm.R': (95 + 15 * math.sin(a), 0, 20), 'upper_arm.L': (-70 - 15 * math.sin(a), 0, 20),
     'forearm.R': 20, 'forearm.L': 10},
    lean=-14 + 4 * math.sin(a), head=8 - 4 * math.sin(a)), 0.006 * math.cos(2 * a))))

# отброшен взрывом: кувырок назад, руки-ноги врастопырку
ANIMS['hurt-fly'] = A(15, True, [P(
    {'upper_arm.R': (150 + 20 * math.sin(2 * a), 0, 30), 'upper_arm.L': (-130 - 20 * math.sin(2 * a), 0, 30),
     'forearm.R': 30, 'forearm.L': 30},
    legs(60 + 15 * math.cos(2 * a), -30, -40 - 15 * math.cos(2 * a), -45),
    head=-20, rot=-360 * i / 12, z=0.15) for i, a in ((i, 2 * math.pi * i / 12) for i in range(12))])

# встаёт: лежит на спине — мотает головой — сел — на корточки — поднялся, отряхнулся
_lie = P(legs(10, -10, 25, -40), both(-60, 30), rot=-90, z=-0.32, head=-10)
_sit = P(legs(95, -15, 85, -25), both(-35, 10), lean=-20, head=10, z=-0.17)
ANIMS['get-up'] = A(10, False, tween(14, [
    (0, _lie),
    (2, P(_lie, head=-25)),
    (3, P(_lie, head=5)),
    (5, _sit),
    (6, P(_sit, lean=-15, head=-12)),
    (8, plant(P(legs(80, -140, 70, -130), both(40, 30), lean=40, head=-10))),
    (10, plant(P(legs(30, -50, 30, -50), both(10, 20), lean=20, head=-5))),
    (11, P(IDLE, **{'upper_arm.R': 30, 'forearm.R': 60})),
    (12, P(IDLE, **{'upper_arm.R': 10, 'forearm.R': 40})),
    (13, IDLE),
]))


# тонет: барахтается, уходит под воду, на воде остаётся одна кепка (вода — по линии подошв)
def _flail(a, z, up=0):
    return P({'upper_arm.R': (165 + up + 20 * math.sin(a), 0, 30), 'upper_arm.L': (165 + up - 20 * math.sin(a), 0, 30),
              'forearm.R': 20 + 20 * math.cos(a), 'forearm.L': 20 - 20 * math.cos(a)},
             legs(20 * math.sin(a), -40, -20 * math.sin(a), -40), head=-20, lean=-6, z=z)


_capz = -0.635
ANIMS['drown'] = A(10, False, [
    _flail(0, -0.15), _flail(1.6, -0.22), _flail(3.2, -0.18), _flail(4.8, -0.28),
    _flail(0, -0.36), _flail(1.6, -0.33), _flail(3.2, -0.45), _flail(4.8, -0.55),
    _flail(0, -0.66), _flail(1.6, -0.74, 10), _flail(3.2, -0.8, 15),
    P(only=['cap'], z=_capz - 0.04, rot=-6), P(only=['cap'], z=_capz + 0.01, rot=4),
    P(only=['cap'], z=_capz - 0.01, rot=-3), P(only=['cap'], z=_capz + 0.005, rot=2),
    P(only=['cap'], z=_capz),
])

# выбыл: сдувается как шарик, кепка слетает, тело со свистом улетает вверх
_puff = P(both((60, 0, 40), 0), legs(10, 0, -10, 0), head=-15)
ANIMS['deflate'] = A(12, False, [
    P(IDLE, both((40, 0, 30), 20), head=-10),
    P(_puff, scale=(1.12, 0.92, 1.12), pivot=0),
    P(_puff, scale=(0.92, 0.86, 0.92), pivot=0, rot=-8),
    P(_puff, scale=(0.82, 0.76, 0.82), pivot=0, rot=8),
    P(_puff, scale=(0.7, 0.68, 0.7), pivot=0, rot=-10),
    P(_puff, scale=(0.62, 0.6, 0.62), pivot=0, rot=12, hide=['cap']),
    P(_puff, scale=0.55, rot=60, z=0.12, fwd=0.1, hide=['cap']),
    P(_puff, scale=0.48, rot=140, z=0.28, fwd=-0.08, hide=['cap']),
    P(_puff, scale=0.42, rot=230, z=0.45, fwd=0.12, hide=['cap']),
    P(_puff, scale=0.36, rot=330, z=0.62, fwd=-0.1, hide=['cap']),
    P(_puff, scale=0.3, rot=420, z=0.8, fwd=0.08, hide=['cap']),
    P(_puff, scale=0.25, rot=500, z=0.98, fwd=-0.04, hide=['cap']),
    P(_puff, scale=0.2, rot=580, z=1.15, hide=['cap']),
    P(only=[]),
])
# кепка, оставшаяся на земле после deflate (и для косметики): один кадр
ANIMS['cap'] = A(1, False, [P(only=['cap'], z=_capz, rot=-4)])

# заморожен: застыл в испуге в ледяном бруске, мелко дрожит
_froz = P(both((70, 0, 20), 50), legs(8, -10, -8, -5), head=-12, lean=-6, ice=True)
ANIMS['frozen'] = A(12, True, [P(_froz, fwd=0.006 * (1 if i % 2 else -1), z=0.002 * (i % 3)) for i in range(8)])

# телепорт: исчезает — присел, вытянулся в нитку и пропал; появляется — обратно с пружинкой
_tp = [
    IDLE,
    P(IDLE, both(-20, 10), scale=(1.12, 0.84, 1.12), pivot=0),
    P(both(170, 0), scale=(0.75, 1.15, 0.75), pivot=0, z=0.02),
    P(both(178, 0), scale=(0.45, 1.25, 0.45), pivot=0, z=0.04),
    P(both(180, 0), scale=(0.22, 1.3, 0.22), pivot=0, z=0.06),
    P(both(180, 0), scale=(0.08, 1.33, 0.08), pivot=0, z=0.08),
    P(both(180, 0), scale=(0.025, 1.35, 0.025), pivot=0, z=0.1),
    P(only=[]),
]
ANIMS['teleport-out'] = A(15, False, _tp)
ANIMS['teleport-in'] = A(15, False, _tp[::-1][:-1] + [P(IDLE, scale=(0.94, 1.08, 0.94), pivot=0), IDLE])

# ---------------- оружие: позы рук, само оружие игра рисует в руке ----------------


def _aim(a):
    lean = 4 - a * 0.12
    return plant(P(legs(14, -10, -10, -4), both((a + 90 - lean, 0, max(0, a - 30) * 0.35), 0),
                   head=-a * 0.3 + 2, lean=lean))


ANIMS['aim'] = A(12, False, [_aim(a) for a in range(-90, 91, 10)])


def _pistol(a):
    lean = 3 - a * 0.08
    return plant(P(legs(12, -8, -8, -4), {'upper_arm.R': (a + 90 - lean, 0, max(0, a - 30) * 0.35), 'forearm.R': 0,
                                          'upper_arm.L': -12, 'forearm.L': 35},
                   head=-a * 0.3 + 2, lean=lean))


ANIMS['aim-pistol'] = A(12, False, [_pistol(a) for a in range(-90, 91, 10)])

# бросок: замах из-за головы, бросок через верх, доводка
_th0 = P(IDLE, **{'upper_arm.R': 30, 'forearm.R': 70, 'upper_arm.L': 20})
_thw = plant(P(legs(25, -10, -20, -10), {'upper_arm.R': (-160, 0, 15), 'forearm.R': 70, 'upper_arm.L': 85, 'forearm.L': 10},
               lean=-14, head=-6))
ANIMS['throw'] = A(15, False, tween(10, [
    (0, _th0),
    (2, _thw),
    (3, P(_thw, **{'upper_arm.R': (-170, 0, 15), 'forearm.R': 80})),
    (4, plant(P(legs(30, -15, -25, -10), {'upper_arm.R': (-235, 0, 10), 'forearm.R': 20, 'upper_arm.L': 20, 'forearm.L': 30},
                lean=10, head=0)), 'lin'),
    (5, plant(P(legs(30, -15, -25, -10), {'upper_arm.R': -290, 'forearm.R': 0, 'upper_arm.L': -20, 'forearm.L': 30},
                lean=24, head=6))),
    (7, plant(P(legs(25, -15, -20, -10), {'upper_arm.R': -330, 'forearm.R': 10, 'upper_arm.L': -10},
                lean=22, head=6))),
    (9, P(IDLE, **{'upper_arm.R': -350})),
]))

# удар арматурой/битой двумя руками: замах за голову — удар сверху вперёд-вниз
_sw0 = P(IDLE, both(55, 45))
_sww = plant(P(legs(25, -15, -15, -8), both((200, 0, 10), 50), lean=-14, head=-12))
ANIMS['swing'] = A(15, False, tween(10, [
    (0, _sw0),
    (3, _sww),
    (4, P(_sww, both((205, 0, 10), 55))),
    (5, plant(P(legs(30, -18, -20, -8), both((130, 0, 5), 10), lean=8, head=0)), 'lin'),
    (6, plant(P(legs(32, -20, -22, -8), both(65, 0), lean=26, head=8, scale=(1, 0.97, 1), pivot=0))),
    (7, plant(P(legs(32, -20, -22, -8), both(35, 5), lean=30, head=10))),
    (9, _sw0),
]))

# апперкот: присел, кулак снизу — вверх с подскоком
_guard = {'upper_arm.L': 60, 'forearm.L': 120}
ANIMS['punch-uppercut'] = A(15, False, tween(10, [
    (0, P(IDLE, _guard, **{'upper_arm.R': 30, 'forearm.R': 110})),
    (2, plant(P(legs(40, -70, 30, -60), _guard, {'upper_arm.R': -35, 'forearm.R': 100}, lean=24, head=6))),
    (3, plant(P(legs(45, -80, 35, -65), _guard, {'upper_arm.R': -40, 'forearm.R': 105}, lean=28, head=8)), 'lin'),
    (4, P(legs(5, -5, -5, -5), _guard, {'upper_arm.R': 110, 'forearm.R': 80}, lean=-4, head=-8, z=0.03)),
    (5, P(legs(10, -20, -5, -15), _guard, {'upper_arm.R': (165, 0, 15), 'forearm.R': 30}, lean=-12, head=-16, z=0.07)),
    (6, P(legs(10, -20, -5, -15), _guard, {'upper_arm.R': (170, 0, 15), 'forearm.R': 25}, lean=-12, head=-16, z=0.06)),
    (8, plant(P(legs(15, -25, 10, -20), _guard, {'upper_arm.R': 50, 'forearm.R': 100}, lean=8))),
    (9, P(IDLE, _guard, **{'upper_arm.R': 30, 'forearm.R': 110})),
]))

# маваши: колено вверх — нога выстреливает вверх-вперёд, корпус откинут, руки для равновесия
_bal = {'upper_arm.R': (-50, 0, 25), 'upper_arm.L': (110, 0, 20), 'forearm.L': 40, 'forearm.R': 20}
ANIMS['kick-mawashi'] = A(15, False, tween(10, [
    (0, P(IDLE, both(40, 90))),
    (2, P(_bal, legs(95, -110, -5, -5), lean=-8, head=-4, rot=-6, pivot=0, yaw=-15)),
    (3, P(_bal, legs(110, -40, -5, -5), lean=-18, head=-6, rot=-12, pivot=0, yaw=-25), 'lin'),
    (4, P(_bal, legs(120, 0, -5, -5), lean=-24, head=-8, rot=-16, pivot=0, yaw=-20)),
    (5, P(_bal, legs(118, 0, -5, -5), lean=-24, head=-8, rot=-16, pivot=0, yaw=-15)),
    (7, P(_bal, legs(80, -100, -5, -5), lean=-8, rot=-6, pivot=0, yaw=-5)),
    (9, P(IDLE, both(40, 90))),
]))

# тычок палкой/шваброй двумя руками вперёд с выпадом
_pk0 = plant(P(legs(15, -10, -10, -5), both(25, 95), lean=4))
ANIMS['poke'] = A(15, False, tween(8, [
    (0, _pk0),
    (2, plant(P(legs(10, -15, -15, -10), both(-5, 110), lean=-6, head=-2))),
    (3, plant(P(legs(40, -20, -30, -5), both(90, 0), lean=22, fwd=0.05, head=-4)), 'lin'),
    (4, plant(P(legs(42, -20, -32, -5), both(92, 0), lean=24, fwd=0.06, head=-4))),
    (6, plant(P(legs(25, -15, -15, -5), both(50, 60), lean=10, fwd=0.02))),
    (7, _pk0),
]))

# камикадзе «за пацанов»: разбег, кулак вперёд-вверх, корпус вперёд
ANIMS['dash'] = A(16, True, cycle(8, lambda a: P(
    legs(45 * math.sin(a), -40 - 50 * max(0, -math.sin(a)), -45 * math.sin(a), -40 - 50 * max(0, math.sin(a))),
    {'upper_arm.R': (150, 0, 15), 'forearm.R': 15, 'upper_arm.L': 40 * math.sin(a) - 10, 'forearm.L': 90},
    lean=26, head=-18, z=0.03 * abs(math.cos(a)) - 0.02)))

# достать и включить: рука в карман — пульт перед собой — жмёт кнопку — поднимает «готово»
_rem = P(IDLE, head=16, lean=8, **{'upper_arm.R': 45, 'forearm.R': 95})
_rem2 = P(_rem, z=-0.006, **{'forearm.R': 100})
_pock = P(IDLE, head=14, lean=8, **{'upper_arm.R': -12, 'forearm.R': 25})
ANIMS['use-item'] = A(12, False, tween(12, [
    (0, IDLE), (2, _pock), (3, P(_pock, **{'upper_arm.R': -14, 'forearm.R': 20})),
    (5, _rem), (6, _rem2), (7, _rem), (8, _rem2),
    (9, P(_rem, head=-6, lean=0, **{'upper_arm.R': 110, 'forearm.R': 40})),
    (11, P(_rem, head=-6, lean=0, **{'upper_arm.R': 115, 'forearm.R': 40})),
]))

# авиаудар: рация у рта, кричит, второй рукой показывает в небо
_rad = P(IDLE, head=-6, lean=-4, **{'upper_arm.R': (40, 0, 20), 'forearm.R': 135})
_shout = P(_rad, head=-14, lean=-8, z=0.008, **{'upper_arm.L': (155, 0, 15), 'forearm.L': 5})
_calm = P(_rad, head=-4, **{'upper_arm.L': (140, 0, 15), 'forearm.L': 20})
ANIMS['use-radio'] = A(10, False, tween(12, [
    (0, IDLE), (2, _rad), (3, _shout), (4, _calm), (5, _shout), (6, _calm),
    (7, P(_shout, head=-16, z=0.01)), (9, P(_shout, head=-16, z=0.01)), (11, IDLE),
]))

# отбойный молоток вниз: согнулся, руки на рукоятках, всё трясётся
ANIMS['dig'] = A(15, True, [plant(P(
    legs(25, -30, -15, -15), both(45 + (4 if i % 2 else -4), 45),
    lean=26 + (2 if i % 2 else -2), head=8 + (5 if i % 2 else -5),
    scale=(1, 0.98 if i % 2 else 1.0, 1), pivot=0), 0.012 if i % 2 else 0) for i in range(8)])

# паяльная лампа вперёд двумя руками, лёгкое покачивание
ANIMS['torch'] = A(10, True, cycle(8, lambda a: plant(P(
    legs(18, -12, -12, -6),
    {'upper_arm.R': 72 + 3 * math.sin(a), 'forearm.R': 22, 'upper_arm.L': 64 + 3 * math.sin(a), 'forearm.L': 38},
    lean=10 + 2 * math.sin(a), head=4 + 2 * math.cos(a)))))

# висит на верёвке: руки вверх над головой, раскачка, ноги болтаются с запаздыванием
ANIMS['rope-hang'] = A(8, True, cycle(12, lambda a: P(
    both((180, 0, 12), 0), legs(8 + 14 * math.sin(a - 0.8), -15 - 10 * math.cos(a), 4 + 14 * math.sin(a - 1.1), -25),
    rot=14 * math.sin(a), pivot=0.72, head=-8, lean=-2, z=0.12)))

# банджи: вниз головой на резинке, подпрыгивает, руками болтает
ANIMS['bungee'] = A(10, True, cycle(10, lambda a: P(
    {'upper_arm.R': (170 + 25 * math.sin(a), 0, 25), 'upper_arm.L': (170 - 25 * math.sin(a), 0, 25),
     'forearm.R': 15, 'forearm.L': 15},
    legs(-3, 0, 3, 0), head=-15, rot=180 + 6 * math.sin(a + 0.5),
    z=0.12 + 0.07 * math.cos(a), scale=(1, 1 + 0.06 * math.cos(a), 1))))

# зонтик: рука с зонтом вверх, вторая в сторону, ноги скрестил, плавно покачивается
ANIMS['umbrella-float'] = A(8, True, cycle(10, lambda a: P(
    {'upper_arm.R': (178, 0, 15), 'forearm.R': 0, 'upper_arm.L': (70 + 8 * math.sin(a), 0, 15), 'forearm.L': 45},
    legs(14 + 5 * math.sin(a - 0.7), -25, -6 + 5 * math.sin(a - 1.0), -35),
    rot=5 * math.sin(a), pivot=0.75, head=-4, lean=-2, z=0.1 + 0.015 * math.sin(a))))

# огнетушитель-ранец: летит наклонившись, руки держат лямки, ноги болтаются, трясёт
ANIMS['jetpack'] = A(12, True, [P(
    both(15, 115), legs(-12 + 6 * math.sin(a), -30 - 8 * math.cos(a), -22 + 6 * math.sin(a + 1), -40),
    lean=12, head=-14, rot=10, z=0.08 + (0.006 if i % 2 else -0.006))
    for i, a in ((i, 2 * math.pi * i / 8) for i in range(8))])

# пьёт газировку: банку ко рту, запрокидывает голову, глотает, «а-а-ах»
_can = P(IDLE, **{'upper_arm.R': 25, 'forearm.R': 70})
_sip = P(IDLE, head=-26, lean=-10, **{'upper_arm.R': (75, 0, 15), 'forearm.R': 120})
ANIMS['drink'] = A(10, False, tween(14, [
    (0, _can),
    (3, _sip),
    (4, P(_sip, head=-30, **{'upper_arm.R': (88, 0, 15)})),
    (5, P(_sip, head=-28)),
    (6, P(_sip, head=-32, **{'upper_arm.R': (95, 0, 15)})),
    (7, P(_sip, head=-28)),
    (8, P(_sip, head=-34, **{'upper_arm.R': (100, 0, 15)})),
    (10, P(_can, head=-12, lean=-6, scale=(1.04, 1.02, 1.04), pivot=0, **{'upper_arm.R': 30})),
    (11, P(_can, head=6, lean=8)),
    (13, _can),
]))

# ставит плиту: присел, поднял над головой (кряхтит), шаг и опустил перед собой
_lift = plant(P(legs(10, -15, -10, -8), both((175, 0, 20), 5), lean=-8, head=-10))
ANIMS['place-slab'] = A(12, False, tween(12, [
    (0, IDLE),
    (2, plant(P(legs(55, -95, 50, -90), both(60, 10), lean=36, head=10))),
    (4, plant(P(legs(25, -40, 20, -35), both((140, 0, 15), 20), lean=6, head=-6))),
    (5, P(_lift, scale=(1.02, 0.97, 1.02), pivot=0)),
    (6, _lift),
    (7, P(_lift, scale=(1.02, 0.97, 1.02), pivot=0)),
    (9, plant(P(legs(40, -25, -20, -10), both(95, 0), lean=26, fwd=0.04, head=4))),
    (10, plant(P(legs(40, -25, -20, -10), both(75, 0), lean=30, fwd=0.04, head=6))),
    (11, IDLE),
]))

# ---------------- эмоции ----------------

# присядка: на корточках, руки скрещены, по очереди выбрасывает ноги вперёд с подскоком
_cross = {'upper_arm.R': (55, 0, -25), 'forearm.R': 105, 'upper_arm.L': (60, 0, -25), 'forearm.L': 100}
_sq = P(_cross, legs(85, -150, 85, -150), lean=10, head=-6)
ANIMS['victory-dance'] = A(12, True, [
    plant(_sq),
    plant(P(_cross, legs(80, -10, 85, -150), lean=4, head=-10), 0.02),
    plant(P(_cross, legs(82, 0, 85, -150), lean=2, head=-12), 0.025),
    plant(P(_cross, legs(85, -80, 85, -150), lean=6, head=-8), 0.01),
    plant(_sq),
    plant(P(_sq, head=0), 0.03),
    plant(_sq),
    plant(P(_cross, legs(85, -150, 80, -10), lean=4, head=-10), 0.02),
    plant(P(_cross, legs(85, -150, 82, 0), lean=2, head=-12), 0.025),
    plant(P(_cross, legs(85, -150, 85, -80), lean=6, head=-8), 0.01),
    plant(_sq),
    plant(P(_sq, head=0), 0.03),
])

# дразнится: ладони у ушей, «бе-бе-бе», качается и пританцовывает
ANIMS['taunt'] = A(10, True, cycle(12, lambda a: plant(P(
    both((150, 0, 50), 110 + 15 * math.sin(3 * a)),
    legs(10 + 10 * max(0, math.sin(a)), -20 * max(0, math.sin(a)), 10 + 10 * max(0, -math.sin(a)), -20 * max(0, -math.sin(a))),
    head=-10 + 10 * math.sin(2 * a), lean=-4 + 6 * math.sin(a), fwd=0.01 * math.sin(a)))))

# сдался: поднимает руки (в правой — белый флаг), голову опустил, флагом машет
_up = P(both((178, 0, 18), 0), legs(8, -12, 8, -12), head=16, lean=4)
_wave = P(_up, **{'upper_arm.R': (165, 0, 18), 'forearm.R': 25})
ANIMS['surrender'] = A(10, False, tween(12, [
    (0, IDLE), (3, P(_up, **{'upper_arm.R': (160, 0, 18), 'forearm.R': 30})),
    (5, _up), (6, _wave), (7, _up), (8, _wave), (9, _up), (10, _wave), (11, _up),
]))

# «курю»: сидит на корточках с термосом, отхлёбывает, ждёт
_squat = P(legs(85, -150, 80, -145), {'upper_arm.L': 55, 'forearm.L': 50}, lean=14, head=-4)
ANIMS['smoke-break'] = A(8, True, tween(12, [
    (0, plant(P(_squat, **{'upper_arm.R': 50, 'forearm.R': 65}))),
    (3, plant(P(_squat, head=-2, **{'upper_arm.R': 52, 'forearm.R': 70}))),
    (5, plant(P(_squat, head=-26, lean=6, **{'upper_arm.R': (78, 0, 15), 'forearm.R': 118}))),
    (7, plant(P(_squat, head=-30, lean=4, **{'upper_arm.R': (84, 0, 15), 'forearm.R': 118}))),
    (9, plant(P(_squat, head=2, **{'upper_arm.R': 50, 'forearm.R': 65}))),
], loop=True))

# испугался гранаты под ногами: отпрянул, руки вверх, смотрит вниз, коленки трясутся
ANIMS['scared'] = A(15, True, [plant(P(
    both((135, 0, 30), 45 + (8 if i % 2 else -8)),
    legs(-6 + (5 if i % 2 else 0), -14 + (6 if i % 2 else 0), -14 + (0 if i % 2 else 5), -8 + (0 if i % 2 else 6)),
    head=26 + (3 if i % 2 else -3), lean=-16, fwd=-0.04, rot=-4, pivot=0), 0.006 * (i % 2)) for i in range(8)])

# попал: кулак вверх — рывок к себе «есть!» — ещё раз
_fist_up = P(legs(5, -5, 5, -5), {'upper_arm.R': (178, 0, 12), 'forearm.R': 0, 'upper_arm.L': 20}, head=-12, lean=-6)
_yes = plant(P(legs(25, -40, 20, -35), {'upper_arm.R': 55, 'forearm.R': 125, 'upper_arm.L': -20}, head=10, lean=18))
ANIMS['celebrate-hit'] = A(12, False, tween(12, [
    (0, IDLE), (2, P(_fist_up, z=0.05)), (3, P(_fist_up, z=0.03)), (5, _yes), (6, _yes),
    (8, P(_fist_up, z=0.02)), (9, _yes), (11, IDLE),
]))
