"""Чаупар (пресет «Шиш-беша»): ткань, вышивка углов и центра, фишки-готи и каури — картинки через routerai.ru
(ключ — из tools/videogen/dist/videogen.json). Сам крест с клетками рисует SVG (src/games/chaupar/board.ts) поверх ткани.
Фишки и каури — на сплошном пурпурном фоне (его убирает cut.py).

  python tools/chaupar/gen.py [--n 2] [имя ...]   → D:/temp/chaupar/raw/<имя>-<k>.png
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "videogen"))
import videogen as V  # noqa: E402

OUT = "D:/temp/chaupar/raw"
MODEL = "black-forest-labs/flux.2-pro"

SPRITE = (
    "Product photo, camera 40 degrees above, centered, alone, soft warm light from the upper left, no cast shadow. "
    "Flat solid magenta background (#FF00FF), evenly lit, nothing else. No text, no letters, no base plate."
)
GOTI = (
    "A single traditional Indian chaupar game piece (goti): hand-turned wooden pawn shaped like a tall rounded beehive cone "
    "with two thin carved rings near the base and a small round knob on top, glossy {c} lacquer with fine golden lacquer lines. "
)
COLORS = {"g0": "bright vermilion red", "g1": "emerald green", "g2": "saffron yellow", "g3": "deep indigo blue"}

PROMPTS = {
    "cloth": (
        "Strict top-down flat lay photo of handwoven deep maroon red cotton khadi cloth filling the entire frame, "
        "fine visible even weave texture, very subtle natural folds, soft even daylight. No pattern, no embroidery, no objects, no text."
    ),
    "corner": (
        "Strict top-down photo of a square panel of traditional Indian hand embroidery filling the entire frame: "
        "a large lotus flower in the middle surrounded by paisleys (buta) and small leaves, colorful silk threads (saffron, pink, green, white) "
        "and shiny gold zari thread, small round mirrors (shisha), on deep maroon red cotton, symmetric, even soft light. No text."
    ),
    "center": (
        "Strict top-down photo of a square traditional Indian embroidered textile medallion filling the entire frame: "
        "a radial mandala lotus with eight petals in gold zari thread and saffron, green and white silk, small mirrors, on black velvet, "
        "symmetric, even soft light. No text."
    ),
    "cowrie_up": "A single natural cowrie sea shell lying with its toothed slit opening facing up toward the camera, glossy cream and pale tan. " + SPRITE,
    "cowrie_down": "A single natural cowrie sea shell lying with its smooth rounded glossy back facing up, cream with soft tan speckles, the slit opening hidden underneath. " + SPRITE,
}
for k, c in COLORS.items():
    PROMPTS[k] = GOTI.format(c=c) + SPRITE


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
                    img, cost = V.gen_image(key, MODEL, PROMPTS[name], 3100 + k, "1:1")
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
