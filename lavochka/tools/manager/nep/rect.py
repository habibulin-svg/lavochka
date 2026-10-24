import sys, cv2, numpy as np
src, out, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
pts = np.float32([list(map(float, p.split(','))) for p in sys.argv[4:8]])  # tl tr br bl
im = cv2.imread(src)
dst = np.float32([[0, 0], [size, 0], [size, size], [0, size]])
M = cv2.getPerspectiveTransform(pts, dst)
w = cv2.warpPerspective(im, M, (size, size), flags=cv2.INTER_LANCZOS4)
cv2.imwrite(out, w)
