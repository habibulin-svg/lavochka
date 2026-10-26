"""Пулук (буль): зёрна-кости, воины, палочки дорожки, циновка — картинки через routerai.ru
(ключ — из tools/videogen/dist/videogen.json). Раскладку дорожки и дома рисует код (src/games/puluk/view.ts) — генерация
даёт только сами предметы. Спрайты — на сплошном пурпурном фоне (его убирает cut.py).

  python tools/puluk/gen.py [--n 2] [имя ...]   → D:/temp/puluk/raw/<имя>-<k>.png
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "videogen"))
import videogen as V  # noqa: E402

OUT = "D:/temp/puluk/raw"
MODEL = "black-forest-labs/flux.2-pro"

BG = "Flat solid magenta background (#FF00FF), evenly lit, nothing else. No text, no letters, no glyphs, no people."
TOP = "Product photo from straight above, centered, alone, soft warm light from the upper left, no cast shadow. "
KERNEL = (
    TOP + "A single large dried kernel of white Guatemalan maize, flat and wide like a tooth, about 1.5 cm, lying flat, "
    "creamy ivory colour with a slightly translucent tip. "
)
WARRIOR = (
    "Product photo of a single small hand-made game piece for an old Maya board game, standing upright, "
    "camera 35 degrees above, centered, alone, soft warm light from the upper left, no cast shadow. "
    "The piece is a short squat cone-shaped figurine about 3 cm tall, a simple stylised warrior: a rounded head with a feathered headdress "
    "crest, a round shield on the chest, no arms detail, a wide flat round base. "
)

PROMPTS = {
    "kernel": KERNEL + "Its upper face is plain and clean. " + BG,
    "kernelm": KERNEL + "On its upper face a bold black dot of charcoal ink is painted in the middle. " + BG,
    "w0": WARRIOR + "Made of fired terracotta clay, warm brick-red ochre colour with cream white painted details, matte. " + BG,
    "w1": WARRIOR + "Made of polished dark basalt grey-black stone with dull jade green painted details, satin. " + BG,
    "stick": (
        TOP + "A single straight thin dry maize stalk stick, about 20 cm long and 7 mm thick, lying horizontally, "
        "pale straw yellow with faint nodes and fibres. " + BG
    ),
    "home": (
        TOP + "A small round shallow woven palm-leaf basket tray, empty, about 15 cm across, seen from straight above, "
        "natural straw colour with a darker brown woven pattern ring. " + BG
    ),
    "table": (
        "Strict top-down flat photo of an old woven petate palm mat filling the entire frame, warm straw-brown colour, "
        "fine diagonal weave, soft even light. No objects, no text."
    ),
}
ASPECT = {"stick": "16:9"}


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
                    img, cost = V.gen_image(key, MODEL, PROMPTS[name], 5200 + k, ASPECT.get(name, "1:1"))
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
