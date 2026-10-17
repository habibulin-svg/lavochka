# Поиск линий сетки на карте: профили тёмных пикселей по полосам.
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter1d

path, axis = sys.argv[1], sys.argv[2]
bands = [tuple(map(int, b.split(':'))) for b in sys.argv[3:]]
im = np.asarray(Image.open(path).convert('L')).astype(float)
for a, b in bands:
    if axis == 'x':
        strip = im[a:b, :]
        # тёмнее соседей по горизонтали
        bg = uniform_filter1d(strip, 15, axis=1)
        d = np.clip(bg - strip, 0, None)
        prof = d.mean(axis=0)
    else:
        strip = im[:, a:b]
        bg = uniform_filter1d(strip, 15, axis=0)
        d = np.clip(bg - strip, 0, None)
        prof = d.mean(axis=1)
    # пики
    peaks = []
    for i in range(3, len(prof) - 3):
        if prof[i] == prof[i-3:i+4].max() and prof[i] > np.percentile(prof, 85):
            peaks.append(i)
    print(f'{a}:{b}', ' '.join(str(p) for p in peaks))
