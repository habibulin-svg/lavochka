# Выравнивает фото src по эталону ref (SIFT + RANSAC), пишет выровненное в out
import sys, cv2, numpy as np
ref, src, out = sys.argv[1:4]
A = cv2.imread(ref); B = cv2.imread(src)
g = lambda x: cv2.cvtColor(x, cv2.COLOR_BGR2GRAY)
sift = cv2.SIFT_create(8000)
ka, da = sift.detectAndCompute(g(A), None)
# эталон крупнее — уменьшаем для сопоставления масштабов не нужно, SIFT инвариантен
kb, db = sift.detectAndCompute(g(B), None)
m = cv2.BFMatcher().knnMatch(db, da, k=2)
good = [x for x, y in m if x.distance < 0.75 * y.distance]
pb = np.float32([kb[x.queryIdx].pt for x in good]); pa = np.float32([ka[x.trainIdx].pt for x in good])
H, mask = cv2.findHomography(pb, pa, cv2.RANSAC, 6.0)
print('matches', len(good), 'inliers', int(mask.sum()))
w = cv2.warpPerspective(B, H, (A.shape[1], A.shape[0]), flags=cv2.INTER_LANCZOS4)
cv2.imwrite(out, w)
