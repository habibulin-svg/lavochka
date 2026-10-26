"""Далдос: доска-лодка, фишки-колышки и кость-призма — картинки через routerai.ru (ключ — из tools/videogen/dist/videogen.json).
Лунки на доске и насечки на костях рисует код (src/games/daldos/view.ts) — генерация даёт только сами предметы.
Всё на сплошном пурпурном фоне (его убирает cut.py).

  python tools/daldos/gen.py [--n 2] [имя ...]   → D:/temp/daldos/raw/<имя>-<k>.png
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "videogen"))
import videogen as V  # noqa: E402

OUT = "D:/temp/daldos/raw"
MODEL = "black-forest-labs/flux.2-pro"

BG = "Flat solid magenta background (#FF00FF), evenly lit, nothing else. No text, no letters, no runes, no people."
SPRITE = "Product photo, camera 55 degrees above, centered, alone, soft warm light from the upper left, no cast shadow. " + BG
PIECE = (
    "A single hand-carved wooden game piece for the old Danish folk board game daldos, standing upright on its peg end, "
    "camera 50 degrees above, centered, alone, soft warm light from the upper left, no cast shadow. "
)
WIDE = "shaped like a small flat wooden spatula or paddle: a wide thin blade with a rounded top, narrowing to a short peg at the bottom, pale birch wood, honey-white, oiled, fine grain. "
OBELISK = "shaped like a slim flattened obelisk: a tapering blade with a rectangular cross-section twice as wide as thick and a pointed pyramid top, a short round peg at the bottom, dark walnut wood stained almost black-brown, oiled, fine grain. "
FACE = "The flat broad face of the piece is turned straight toward the camera. "
EDGE = "The piece is seen exactly from its narrow side edge, so it looks thin. "
PIECES = {
    "p0": PIECE + WIDE + FACE + BG,
    "p0e": PIECE + WIDE + EDGE + BG,
    "p1": PIECE + OBELISK + FACE + BG,
    "p1e": PIECE + OBELISK + EDGE + BG,
}

PROMPTS = {
    "board": (
        "Strict top-down orthographic photo of a hand-carved Scandinavian folk game board shaped like a rowing boat seen from straight above: "
        "the left end is a flat square stern (transom), the right end is a pointed bow, the long sides are gently curved, "
        "the board is wide: its length is about three and a half times its width, lying horizontally, filling the frame with a small margin. "
        "Thick solid oak plank, flat top surface, oiled honey-brown wood with beautiful straight grain running lengthwise, "
        "a slightly rounded bevelled edge, a thin carved groove running around the board parallel to the edge. "
        "The flat top is completely plain: no holes, no pegs, no markings, no carvings in the middle. "
        "Even soft light, no cast shadow. " + BG
    ),
    "die": (
        "Product photo from straight above of a single long four-sided wooden die for a Scandinavian folk game: a bar of pale birch wood "
        "chunky, about 2 by 2 cm in cross section and 5 cm long including the ends, square cross section, the two ends cut to blunt pyramid points, lying flat horizontally, "
        "one flat face up toward the camera, the top face completely plain and smooth, slightly worn edges, fine grain. "
        "Soft light from the upper left, no cast shadow. " + BG
    ),
    "table": (
        "Strict top-down flat photo of an old rough Scandinavian pine table top made of wide planks filling the entire frame, "
        "weathered warm brown wood, soft even daylight. No objects, no text."
    ),
    **PIECES,
}
ASPECT = {"board": "21:9", "die": "16:9"}


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
                    img, cost = V.gen_image(key, MODEL, PROMPTS[name], 4100 + k, ASPECT.get(name, "1:1"))
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
