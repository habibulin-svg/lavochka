"""Санторини: поле, постройки и строители — картинки через routerai.ru (ключ — из tools/videogen/dist/videogen.json).
Поле — вид строго сверху; постройки и строители — спрайты «три четверти» на белом (фон убирает cut.py).
Каждое состояние башни — своя картинка (1, 2, 3 яруса, 3 с куполом, купол на 0/1/2), чтобы ярусы были одного рисунка.

  python tools/santorini/gen.py [--n 2] [имя ...]   → D:/temp/santorini/raw/<имя>-<k>.png
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "videogen"))
import videogen as V  # noqa: E402

OUT = "D:/temp/santorini/raw"
MODEL = "black-forest-labs/flux.2-pro"

SPRITE = (
    "Board game miniature, isometric view: camera 35 degrees above, one vertical corner of the square block points straight at the viewer, "
    "centered, alone, soft warm light from the upper left, gentle shading on the object only, no cast shadow. "
    "Flat solid chroma key green background (#00B140), evenly lit, nothing else. "
    "No text, no letters, no people, no ground, no base plate."
)
TOWER = "Cycladic Greek architecture piece made of matte white plaster with slightly rounded edges and small dark arched windows"
LEVELS = {
    1: "a wide low square block, the first floor, with two small arched windows on each visible side",
    2: "a wide square first floor block with a slightly narrower square second floor block stacked on it, both with small arched windows",
    3: "three stacked square floor blocks, each a bit narrower than the one below, like a stepped tower, small arched windows",
}

PROMPTS = {
    "board": (
        "Strict top-down orthographic view of a square board game board: a small rocky Greek island seen from straight above, "
        "with a flat square plaza of pale limestone in the middle divided into an exact grid of 5 by 5 equal square tiles with thin grout lines, "
        "the plaza occupies the central 72% of the image, surrounded by sunny cliffs, a few olive bushes and white stones, "
        "deep turquoise Aegean sea in the corners. Even daylight, no shadows of buildings, no buildings, no people, no text."
    ),
    "iso": (
        "Isometric view, camera 35 degrees above, board game diorama: a small rocky Greek island in a calm turquoise Aegean sea. "
        "On top lies one perfectly flat, plain, empty square slab of smooth pale limestone, rotated 45 degrees so one corner points straight "
        "at the viewer: it looks like a wide symmetric diamond, centered, its width about 62% of the image width. The slab has no lines, no tiles, no pattern. "
        "Warm volcanic cliffs fall to the sea, a few olive bushes and white stones around the slab, soft warm afternoon light, beautiful, high detail. "
        "No buildings, no people, no figures, no text, nothing on the slab."
    ),
    "l1": f"{TOWER}: {LEVELS[1]}. {SPRITE}",
    "l2": f"{TOWER}: {LEVELS[2]}. {SPRITE}",
    "l3": f"{TOWER}: {LEVELS[3]}. {SPRITE}",
    "l3d": f"{TOWER}: {LEVELS[3]}, crowned on top by a round bright cobalt blue dome. {SPRITE}",
    "w0": "A small stylized board game pawn figure of an ancient Greek builder in a short tunic, made of glossy cream ivory plastic, simple rounded shapes, standing, full body. " + SPRITE.replace("no people, ", ""),
    "w1": "A small stylized board game pawn figure of an ancient Greek builder in a short tunic, made of glossy deep navy blue plastic, simple rounded shapes, standing, full body. " + SPRITE.replace("no people, ", ""),
}
ASPECT = {"board": "1:1", "iso": "4:3"}


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
                    img, cost = V.gen_image(key, MODEL, PROMPTS[name], 2000 + k, ASPECT.get(name, "1:1"))
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
