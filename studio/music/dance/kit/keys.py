"""Клавишные и аккорды (~120): пиано-хаус, органы, электропиано, «оффбит-аккорды»."""
import patterns as P
from kit import theme

G = 'keys'
THEMES = [  # имя, пресет, рисунок, эффект, стиль
    ('House Piano', 'John Valentine/Keys/Grand Piano', P.stabs('x..x..x...x..x..x..x..x...x..x..', 72, top=True), 'keys', 'house'),
    ('Piano Riff', 'Dan Maurer/Keys/Forte Piano', P.riff(91), 'keys', 'house'),
    ('Dream Piano', 'Bluelight/Keys/Pianoish', P.broken(64), 'keys', 'dream'),
    ('Organ One', 'Keys/House Organ', P.stabs('..x...x...x...x...x...x...x...x.', 64, dur=0.3), 'keys', 'euro'),
    ('Organ Two', 'Giana Brotherz/Organs/Deep Houser', P.stabs('x..x..x...x..x..x..x..x...x.x...', 67, dur=0.4), 'keys_dry', 'house'),
    ('Wonderline', 'Cybersoda/Keys/Vintage EP', P.stabs('x.....x...x.....x.....x...x.x...', 67, size=4, dur=0.9), 'keys', 'dream'),
    ('Offbeat Chords', 'Emu/Keys/Light EP', P.stabs('..x...x...x...x...x...x...x...x.', 72, dur=0.35), 'keys', 'euro'),
    ('Rhodes Sync', 'Bluelight/Keys/Treated Rhodes', P.stabs('x..x..x...x..x...x.x..x...x..x..', 67, size=4, dur=0.3), 'keys', 'house'),
    ('Skank', 'Keys/Organ 2', P.stabs('..x...xx..x...xx..x...xx..x...x.', 69, dur=0.2), 'keys_dry', 'euro'),
    ('Stride', 'Dan Maurer/Keys/FM Piano 1', P.stride(67), 'keys', 'house'),
    ('Wurli Waltz', 'Cybersoda/Keys/Wurli', P.broken(60, (0, 1, 2, 1), 0.5, 0.9, top=False), 'keys', 'dream'),
    ('Rotary', 'Giana Brotherz/Organs/Wanna B3', P.stabs('x.......x.x.....x.......x.x.x...', 64, size=4, dur=1.4), 'keys_dry', 'house'),
    ('Digi Bells', 'Plucks/Fantasy Bell', P.broken(72, (0, 1, 2, 3), 0.25, 0.3, top=False), 'keys', 'trance'),
    # DX7-голоса Dexed (номер — голос встроенного картриджа, см. synths.dexed)
    ('DX Pharoh', 'dexed:3', P.stabs('..x...x...x...x...x...x...x..xx.', 69, dur=0.3), 'keys', 'euro'),
    ('FM Chime', 'dexed:12', P.broken(72, (0, 2, 1, 2), 0.5, 0.45, top=False), 'keys', 'dream'),
]
for name, patch, fn, fx, style in THEMES:
    theme(G, name, patch, fn, fx, style)
