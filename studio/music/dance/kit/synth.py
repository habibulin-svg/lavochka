"""Синты (~80): суперпила-стабы, медь, хуки лидов — 4 аккорда, нарезки, вся последовательность; нейтральные хуки."""
import patterns as P
from kit import neutral, theme

G = 'synth'
THEMES = [  # имя, пресет, рисунок, эффект, стиль
    ('Anthem Stab', 'Polysynths/Tarnce', P.stabs('..x...x...x...x...x...x...x...x.', 72, size=4, dur=0.35), 'stab', 'trance'),
    ('Rave Stab', 'Polysynths/Megasynth 2', P.stabs('x..x..x...x..x..x..x..x...x.x...', 69, size=4, dur=0.25), 'stab', 'euro'),
    ('Brass Hit', 'Brass/Synth Brass 1', P.stabs('x.......x.x.....x.......x.x.x.x.', 67, size=3, dur=0.3), 'stab', 'euro'),
    ('Jupiter Chords', 'Polysynths/Jupiter-8', P.stabs('x.....x.....x...x.....x.....x...', 64, size=4, dur=1.2), 'stab', 'dream'),
    ('Hook One', 'Leads/Classic Lead 1', P.hook(41), 'lead', 'euro'),
    ('Hook Two', 'Leads/Saw Octaves', P.hook(42), 'lead', 'trance'),
    ('Fairy Lead', 'Leads/Fairy', P.hook(47, 76, 93), 'lead', 'dream'),
    ('Square Hook', 'Leads/Square', P.hook(44), 'lead', 'house'),
]
for name, patch, fn, fx, style in THEMES:
    theme(G, name, patch, fn, fx, style)

neutral(G, 'Hook A', 'Leads/Classic Lead 2', P.neutral_hook(51), 'lead', 'euro')
neutral(G, 'Hook E', 'Leads/Moogy Saw', P.neutral_hook(52), 'lead', 'trance')
neutral(G, 'Siren Lead', 'Leads/Sine Lead', P.neutral_hook(53), 'lead', 'dream')
neutral(G, 'Turbo Call', 'Leads/Turbo', P.neutral_hook(54), 'lead', 'house')
