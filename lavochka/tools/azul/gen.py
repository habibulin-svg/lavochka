"""Плиточник: советский кафель, ящики стройрынка, стена ванной — картинки через routerai.ru (ключ — из tools/videogen/dist/videogen.json).
Плитки и мастерок — строго сверху; ящик — открытый, сверху; фактуры (штукатурка, прилавок, пол) — ровные, без предметов.

  python tools/azul/gen.py [--n 2] [имя ...]   → D:/temp/azul/raw/<имя>-<k>.png
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "videogen"))
import videogen as V  # noqa: E402

OUT = "D:/temp/azul/raw"
MODEL = "black-forest-labs/flux.2-pro"

TILE = (
    "Strict top-down orthographic photo of one single square ceramic wall tile, 15 by 15 cm, perfectly square and straight, "
    "filling the whole frame edge to edge, soft even studio light, slight glaze reflection, high detail, Soviet 1970s bathroom tile. "
    "No grout, no other tiles, no background, no text, no shadow."
)
PROMPTS = {
    "t0": f"Plain glossy white glazed tile with a faint crackle and slightly rounded edges. {TILE}",
    "t1": f"Plain glossy pale sky-blue glazed tile, even color, slightly rounded edges. {TILE}",
    "t2": f"White glazed tile with a hand-painted cobalt and ochre stylized flower ornament in the middle and small corner leaves, Soviet decor tile. {TILE}",
    "t3": f"Matte unglazed terracotta red-brown Metlakh floor tile with a subtle raised geometric relief pattern of small squares, Soviet metlakh tile. {TILE}",
    "t4": f"Glossy black glazed tile with white and grey marble-like veins. {TILE}",
    "trowel": (
        "Strict top-down view of an old Soviet bricklayer's trowel with a wooden handle and a worn steel blade with a little cement on it, "
        "centered, alone, soft light. Flat solid chroma key green background (#00B140), nothing else. No text, no shadow."
    ),
    "box": (
        "Strict top-down view straight into an open empty square brown corrugated cardboard box with the four flaps folded outward, "
        "centered, the box opening is square, worn and slightly dusty, soft even light. "
        "Flat solid chroma key green background (#00B140), nothing else. No text, no labels, no shadow."
    ),
    "wall": (
        "Flat frontal photo texture of an old bathroom wall in a Soviet apartment being renovated: grey cement plaster with trowel marks, "
        "a few pencil marks and dried tile adhesive smears, evenly lit, no objects, no tiles, no text, seamless-looking, high detail."
    ),
    "counter": (
        "Flat top-down photo texture of a worn wooden market counter made of painted planks, faded green paint with scratches, "
        "evenly lit, no objects, no text, high detail."
    ),
    "floor": (
        "Flat top-down photo texture of a dusty concrete floor of a 1990s Russian building materials market, with faint footprints and a few cement stains, "
        "evenly lit, no objects, no text, high detail."
    ),
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
                    img, cost = V.gen_image(key, MODEL, PROMPTS[name], 3000 + k, "1:1")
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
