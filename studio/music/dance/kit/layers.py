"""Подложки (~110): пэды, струнные, хоры — 4 аккорда, нарезки, вся последовательность, у части — Reverse."""
import patterns as P
from kit import theme

G = 'layer'
THEMES = [  # имя, пресет, рисунок, эффект, стиль, обратные
    ('Sleeping Comet', 'Pads/MKS-70 Warm Pad', P.pad(60), 'pad', 'dream', True),
    ('Night On Moon', 'Polysynths/Juno-60 Strings', P.pad(62, 4), 'pad', 'euro', True),
    ('Strings In The Pool', 'Argitoth/Pads/Classic Strings', P.pad(64, 3, spread=1), 'pad_soft', 'dream', False),
    ('Choir Of Angels', 'Giana Brotherz/Pads/Deep Choir', P.pad(64), 'pad_soft', 'trance', True),
    ('Ooh Machine', 'Pads/Ooh', P.pad(60, 3), 'pad', 'euro', False),
    ('Warm Blanket', 'Databroth/Pads/Warmbo', P.pad(58, 4, restrike=True), 'pad', 'house', False),
    ('Lush Horizon', 'Cybersoda/Pads/Lush', P.pad(66, 3), 'pad_phase', 'trance', True),
    ('Glass Cathedral', 'Damon Armani/Pads/Church Pad', P.pad(62, 4), 'pad_soft', 'dream', False),
    ('Gate Keeper', 'Luna/Synths/Efficient Poly', P.gate('x.xx.x.xx.xx.x.xx.xx.x.xx.xx.x.x', 64), 'pad', 'trance', False),
    ('Slow 3D', 'dexed:30', P.pad(62, 3), 'pad_soft', 'dream', False),
    ('Polymoog Dawn', 'Polysynths/Polymoog', P.pad(60, 3, restrike=True), 'pad', 'house', True),
]
for name, patch, fn, fx, style, rev in THEMES:
    theme(G, name, patch, fn, fx, style, reverse=rev)
