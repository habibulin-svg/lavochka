# Период и фаза сетки по профилю тёмных линий: python grid-period.py <карта> <x|y> <from> <to> <pmin> <pmax>
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter1d
path, axis, a, b, pmin, pmax = sys.argv[1], sys.argv[2], *map(float, sys.argv[3:7])
g = np.asarray(Image.open(path).convert('L')).astype(float)
if axis == 'x':
    s = g[int(a):int(b), :]; prof = np.clip(uniform_filter1d(s, 15, axis=1) - s, 0, None).mean(axis=0)
else:
    s = g[:, int(a):int(b)]; prof = np.clip(uniform_filter1d(s, 15, axis=0) - s, 0, None).mean(axis=1)
prof = prof - uniform_filter1d(prof, 101)
best = None
for p in np.arange(pmin, pmax, 0.02):
    for ph in np.arange(0, p, 0.5):
        idx = np.arange(ph, len(prof) - 1, p).astype(int)
        sc = prof[idx].mean()
        if best is None or sc > best[0]: best = (sc, p, ph)
print('score %.3f period %.2f phase %.1f' % best)
