"""Петтейя и латрункули: фактуры досок (мрамор, терракота), стол и фишки (камешки, стеклянные «пешки» римлян) —
картинки через routerai.ru (ключ — из tools/videogen/dist/videogen.json). Сетку, края доски и знак дукса рисует код
(src/games/petteia/view.ts) — генерация даёт только поверхности и сами фишки. Фишки — на зелёном фоне (его убирает cut.py).

  python tools/petteia/gen.py [--n 2] [имя ...]   → D:/temp/petteia/raw/<имя>-<k>.png
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "videogen"))
import videogen as V  # noqa: E402

OUT = "D:/temp/petteia/raw"
MODEL = "black-forest-labs/flux.2-pro"

BG = "Flat solid chroma-key green background (#00FF00), evenly lit, nothing else. No text, no letters, no people."
TOP = "Strict top-down orthographic photo seen from straight above, the surface fills the entire frame edge to edge, no borders, no objects, no text, soft even daylight. "
PIECE = "Museum product photo from straight above of a single ancient game counter lying flat, centered, alone, small in the frame with wide margins, soft light from the upper left, no cast shadow. "

PROMPTS = {
    "marble": TOP + "Ancient weathered white Greek marble slab, warm ivory white with faint grey veins, slightly worn and polished by hands, "
    "a few tiny chips and pores. Completely plain: no lines, no grid, no carvings.",
    "clay": TOP + "Ancient Roman fired terracotta roof tile surface, warm orange-red clay, slightly uneven, fine sand grains, faint finger smoothing marks, "
    "a few darker scorch spots. Completely plain: no lines, no grid, no stamps.",
    "table": TOP + "Old worn grey limestone pavement of a Roman forum, large square flagstones with narrow joints, warm afternoon light.",
    "pw": PIECE + "A smooth flat round white river pebble, milky white quartzite, slightly oval, polished by water. " + BG,
    "pb": PIECE + "A smooth flat round black river pebble, dark basalt, slightly oval, polished by water, subtle sheen. " + BG,
    "gw": PIECE + "A Roman glass gaming counter: plano-convex hemispherical bead of opaque milky white glass, round, glossy, tiny bubbles inside. " + BG,
    "gb": PIECE + "A Roman glass gaming counter: plano-convex hemispherical bead of very dark cobalt blue almost black glass, round, glossy, tiny bubbles inside. " + BG,
}


def main():
    args = sys.argv[1:]
    n = 2
    if "--n" in args:
        i = args.index("--n")
        n = int(args[i + 1])
        del args[i:i + 2]
    ids = args or list(PROMPTS)
    with open(os.path.join(os.path.dirname(__file__), "..", "videogen", "dist", "videogen.json"), encoding="utf-8") as f:
        key = json.load(f)["key"]
    os.makedirs(OUT, exist_ok=True)
    total = 0.0
    for name in ids:
        for k in range(n):
            path = f"{OUT}/{name}-{k}.png"
            if os.path.exists(path):
                continue
            for attempt in range(8):  # у BFL ограничение на число задач — ждём и пробуем снова
                try:
                    img, cost = V.gen_image(key, MODEL, PROMPTS[name], 5200 + k, "1:1")
                    break
                except V.ApiError as e:
                    if "429" not in str(e) or attempt == 7:
                        raise
                    time.sleep(15)
            with open(path, "wb") as f:
                f.write(img)
            total += cost
            print(path, f"{cost:.2f} ₽", flush=True)
    print(f"итого {total:.2f} ₽")


if __name__ == "__main__":
    main()
