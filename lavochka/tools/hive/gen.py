"""Насекомые для фишек «Улья»: картинки через routerai.ru (ключ — из tools/videogen/dist/videogen.json).
Каждое насекомое — одна картинка (цвет свой, как гравировка на бакелите), фон потом убирает cut.py.

  python tools/hive/gen.py [--n 2] [насекомое ...]   → D:/temp/hive/raw/<id>-<k>.png
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "videogen"))
import videogen as V  # noqa: E402

OUT = "D:/temp/hive/raw"
MODEL = "black-forest-labs/flux.2-pro"

STYLE = (
    "Single insect emblem, strict top-down view, perfectly centered, symmetric, filling about 70% of the frame. "
    "Bold clean silhouette like an inlaid enamel engraving on a game tile: flat saturated color with a few darker "
    "engraved detail lines, no shading gradients, no shadow. Plain pure white background, nothing else. "
    "No text, no letters, no border, no frame, no hexagon."
)

BUGS = {
    "queen": "a queen honey bee with spread wings, golden yellow and amber color",
    "ant": "a soldier ant with six legs and antennae, bright cobalt blue color",
    "spider": "a spider with eight long legs, warm chestnut brown color",
    "beetle": "a stag-like round beetle with closed shell, violet purple color",
    "hopper": "a grasshopper with long folded hind legs, fresh leaf green color",
    "mosquito": "a mosquito with thin long legs and narrow wings, slate grey color",
    "ladybug": "a ladybug with black spots, bright red color",
    "pillbug": "a pillbug woodlouse with segmented armored back, steel grey-blue color",
}


def main():
    args = sys.argv[1:]
    n = 2
    if "--n" in args:
        i = args.index("--n")
        n = int(args[i + 1])
        del args[i:i + 2]
    ids = args or list(BUGS)
    with open(os.path.join(os.path.dirname(__file__), "..", "videogen", "dist", "videogen.json"), encoding="utf-8") as f:
        key = json.load(f)["key"]
    os.makedirs(OUT, exist_ok=True)
    total = 0.0
    for b in ids:
        for k in range(n):
            path = f"{OUT}/{b}-{k}.png"
            if os.path.exists(path):
                continue
            for attempt in range(8):  # у BFL ограничение на число задач — ждём и пробуем снова
                try:
                    img, cost = V.gen_image(key, MODEL, f"{BUGS[b]}. {STYLE}", 1000 + k)
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
