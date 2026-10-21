"""Видео-персонажи для холдема через шлюз routerai.ru: сначала картинка-эталон каждого персонажа, потом ролики-реакции
из этой картинки (image-to-video). Окно: ключ, модели, персонажи, реакции, оценка цены, папка с результатом.
Наборы «Аркада: …» — только картинки (фоны, фишки листом, персонажи) со своим соотношением сторон.

Результат: <папка>/<персонаж>/ref.png и <персонаж>_<реакция>.mp4, у аркад — <папка>/<набор>/<картинка>.png;
общий log.txt и costs.csv.
Уже готовые файлы пропускаются — можно останавливать и продолжать. Чтобы перегенерировать — удалить файл.

Сборка exe: build.bat (PyInstaller). Зависимостей нет — только стандартная библиотека Python."""

import base64
import csv
import json
import os
import queue
import sys
import threading
import time
import tkinter as tk
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from tkinter import filedialog, messagebox, ttk

import prompts as P

API = "https://routerai.ru/api/v1"

# Цены — ориентир с сайта routerai.ru (октябрь 2026), рубли. Точная цена приходит в ответе (usage.cost) и пишется в costs.csv.
IMAGE_MODELS = {
    "black-forest-labs/flux-3-image": {"label": "FLUX.3 Image — ≈5,3 ₽ за картинку 1K", "price": 5.30},
    "black-forest-labs/flux.2-pro": {"label": "FLUX.2 Pro — ≈3,3 ₽ за картинку 1K", "price": 3.31},
    "bytedance-seed/seedream-4.5": {"label": "Seedream 4.5 — ≈4,4 ₽", "price": 4.42},
    "x-ai/grok-imagine-image-quality": {"label": "Grok Imagine Image — ≈5,5 ₽", "price": 5.52},
}

VIDEO_MODELS = {
    "x-ai/grok-imagine-video-1.5-lite": {
        "label": "Grok Imagine Video 1.5 Lite — 2,21 ₽/с (480p), без последнего кадра",
        "per_s": {"480p": 2.21, "720p": 3.31},
        "per_image": 1.10,
        "last": False,
        "dur": (1, 15),
    },
    "kwaivgi/kling-v3.0-std": {
        "label": "Kling 3.0 Std — 9 ₽/с (720p), первый И последний кадр",
        "per_s": {"720p": 9.0},
        "per_image": 0,
        "last": True,
        "dur": (3, 15),
        "audio_flag": True,
    },
    "black-forest-labs/flux-3-video": {
        "label": "FLUX.3 Video — 18 ₽/с (720p), первый и последний кадр",
        "per_s": {"720p": 18.0, "1080p": 32.0},
        "per_image": 0,
        "last": True,
        "dur": (5, 20),
    },
    "x-ai/grok-imagine-video": {
        "label": "Grok Imagine Video — 5,5 ₽/с (480p), без последнего кадра",
        "per_s": {"480p": 5.52, "720p": 7.0},
        "per_image": 0.22,
        "last": False,
        "dur": (1, 15),
    },
}


def here() -> str:
    """Папка программы (рядом с exe или со скриптом)."""
    return os.path.dirname(sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__))


CONFIG = os.path.join(here(), "videogen.json")


def prompts_file(set_id: str) -> str:
    return os.path.join(here(), P.SETS[set_id]["file"])


def load_prompts(set_id: str) -> dict:
    """Промпты набора из json рядом с программой (если нет — создаём его из встроенных, чтобы было что править)."""
    s = P.SETS[set_id]
    data = {k: s[k] for k in ("image", "video", "characters", "reactions")}
    path = prompts_file(set_id)
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                user = json.load(f)
            data.update({k: v for k, v in user.items() if k in data})
        except Exception as e:  # кривой файл — работаем на встроенных
            print(path, e)
    else:
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except OSError:
            pass
    return data


# ---------------------------------------------------------------- API


class ApiError(Exception):
    pass


def request(key: str, method: str, path: str, body: dict | None = None, raw: bool = False, timeout: int = 180):
    url = path if path.startswith("http") else API + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {key}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = r.read()
            return payload if raw else json.loads(payload or b"{}")
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")[:600]
        raise ApiError(f"HTTP {e.code}: {text}") from None
    except urllib.error.URLError as e:
        raise ApiError(f"сеть: {e.reason}") from None


# Размер для моделей, которые не понимают aspect_ratio.
SIZES = {"1:1": "1024x1024", "4:3": "1024x768", "3:4": "768x1024", "16:9": "1344x768", "2:3": "832x1248"}


def gen_image(key: str, model: str, prompt: str, seed: int | None, aspect: str = "1:1") -> tuple[bytes, float]:
    body = {"model": model, "prompt": prompt, "n": 1, "aspect_ratio": aspect, "resolution": "1K", "output_format": "png"}
    if seed is not None:
        body["seed"] = seed
    try:
        r = request(key, "POST", "/images", body)
    except ApiError as e:
        # не все модели понимают resolution — пробуем размером
        if "HTTP 4" not in str(e) or "HTTP 401" in str(e) or "HTTP 402" in str(e):
            raise
        body.pop("resolution", None)
        body.pop("aspect_ratio", None)
        body["size"] = SIZES.get(aspect, "1024x1024")
        r = request(key, "POST", "/images", body)
    item = (r.get("data") or [{}])[0]
    if item.get("b64_json"):
        img = base64.b64decode(item["b64_json"])
    elif item.get("url"):
        img = request(key, "GET", item["url"], raw=True)
    else:
        raise ApiError(f"нет картинки в ответе: {str(r)[:300]}")
    return img, float((r.get("usage") or {}).get("cost") or 0)


def data_uri(png: bytes) -> str:
    kind = "jpeg" if png[:3] == b"\xff\xd8\xff" else "png"
    return f"data:image/{kind};base64," + base64.b64encode(png).decode()


def gen_video(key: str, model: str, prompt: str, ref: bytes, duration: int, resolution: str, last: bool, stop: threading.Event, log) -> tuple[bytes, float]:
    m = VIDEO_MODELS.get(model, {})
    frames = [{"type": "image_url", "image_url": {"url": data_uri(ref)}, "frame_type": "first_frame"}]
    if last:
        frames.append({"type": "image_url", "image_url": {"url": data_uri(ref)}, "frame_type": "last_frame"})
    body = {"model": model, "prompt": prompt, "duration": duration, "resolution": resolution, "aspect_ratio": "1:1", "frame_images": frames}
    if m.get("audio_flag"):
        body["generate_audio"] = False
    # лимит одновременных задач у шлюза — ждём и повторяем
    for attempt in range(60):
        try:
            job = request(key, "POST", "/videos", body)
            break
        except ApiError as e:
            if "HTTP 429" in str(e) and not stop.is_set():
                time.sleep(10)
                continue
            raise
    else:
        raise ApiError("шлюз занят (429) слишком долго")
    vid = job.get("id")
    if not vid:
        raise ApiError(f"нет id задачи: {str(job)[:300]}")
    t0 = time.time()
    while True:
        if stop.is_set():
            raise ApiError("остановлено")
        time.sleep(6)
        st = request(key, "GET", f"/videos/{vid}")
        s = st.get("status")
        if s == "completed":
            urls = st.get("unsigned_urls") or [f"{API}/videos/{vid}/content?index=0"]
            mp4 = request(key, "GET", urls[0], raw=True, timeout=600)
            return mp4, float((st.get("usage") or {}).get("cost") or 0)
        if s in ("failed", "cancelled", "expired"):
            raise ApiError(f"{s}: {st.get('error')}")
        if time.time() - t0 > 30 * 60:
            raise ApiError("ждали 30 минут — не дождались")
        log(f"   … {vid[:8]} {s}, {int(time.time() - t0)} с")


# ---------------------------------------------------------------- окно


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("Видео-персонажи и картинки для сборника — routerai.ru")
        root.geometry("860x800")
        self.cfg = self.load_cfg()
        self.set_id = self.cfg.get("set") if self.cfg.get("set") in P.SETS else "players"
        self.prompts = load_prompts(self.set_id)
        self.q: queue.Queue = queue.Queue()
        self.stop = threading.Event()
        self.busy = False
        self.cost_lock = threading.Lock()
        self.spent = 0.0

        pad = {"padx": 8, "pady": 3}
        top = ttk.Frame(root)
        top.pack(fill="x", **pad)
        ttk.Label(top, text="Ключ API:").grid(row=0, column=0, sticky="w")
        self.key = tk.StringVar(value=self.cfg.get("key", ""))
        ttk.Entry(top, textvariable=self.key, show="•", width=60).grid(row=0, column=1, sticky="we")
        self.remember = tk.BooleanVar(value=bool(self.cfg.get("key")))
        ttk.Checkbutton(top, text="запомнить", variable=self.remember).grid(row=0, column=2)
        ttk.Label(top, text="Папка:").grid(row=1, column=0, sticky="w")
        self.out = tk.StringVar(value=self.cfg.get("out", os.path.join(here(), "videogen_out")))
        ttk.Entry(top, textvariable=self.out, width=60).grid(row=1, column=1, sticky="we")
        ttk.Button(top, text="…", width=3, command=self.pick_dir).grid(row=1, column=2)
        ttk.Label(top, text="Набор:").grid(row=2, column=0, sticky="w")
        self.set_combo = ttk.Combobox(top, values=[s["title"] for s in P.SETS.values()], state="readonly", width=20)
        self.set_combo.current(list(P.SETS).index(self.set_id))
        self.set_combo.grid(row=2, column=1, sticky="w")
        self.set_combo.bind("<<ComboboxSelected>>", lambda e: self.on_set())
        top.columnconfigure(1, weight=1)

        mod = ttk.LabelFrame(root, text="Модели")
        mod.pack(fill="x", **pad)
        ttk.Label(mod, text="Картинка-эталон:").grid(row=0, column=0, sticky="w")
        self.img_model = tk.StringVar(value=self.cfg.get("img_model", "black-forest-labs/flux-3-image"))
        self.img_combo = ttk.Combobox(mod, values=[v["label"] for v in IMAGE_MODELS.values()], state="readonly", width=60)
        self.img_combo.grid(row=0, column=1, columnspan=3, sticky="we")
        self.img_combo.current(list(IMAGE_MODELS).index(self.img_model.get()) if self.img_model.get() in IMAGE_MODELS else 0)
        ttk.Label(mod, text="Видео:").grid(row=1, column=0, sticky="w")
        self.vid_model = self.cfg.get("vid_model", "x-ai/grok-imagine-video-1.5-lite")
        self.vid_combo = ttk.Combobox(mod, values=[v["label"] for v in VIDEO_MODELS.values()], state="readonly", width=60)
        self.vid_combo.grid(row=1, column=1, columnspan=3, sticky="we")
        self.vid_combo.current(list(VIDEO_MODELS).index(self.vid_model) if self.vid_model in VIDEO_MODELS else 0)
        ttk.Label(mod, text="Разрешение:").grid(row=2, column=0, sticky="w")
        self.res = ttk.Combobox(mod, state="readonly", width=8)
        self.res.grid(row=2, column=1, sticky="w")
        ttk.Label(mod, text="Длительность, с:").grid(row=2, column=2, sticky="e")
        self.dur = tk.IntVar(value=int(self.cfg.get("dur", 5)))
        self.dur_spin = ttk.Spinbox(mod, from_=1, to=20, textvariable=self.dur, width=5, command=self.update_cost)
        self.dur_spin.grid(row=2, column=3, sticky="w")
        self.last = tk.BooleanVar(value=True)
        self.last_chk = ttk.Checkbutton(mod, text="последний кадр = эталон (ролики склеиваются без скачка)", variable=self.last, command=self.update_cost)
        self.last_chk.grid(row=3, column=1, columnspan=3, sticky="w")
        ttk.Label(mod, text="Попыток эталона:").grid(row=4, column=0, sticky="w")
        self.variants = tk.IntVar(value=int(self.cfg.get("variants", 1)))
        ttk.Spinbox(mod, from_=1, to=4, textvariable=self.variants, width=5, command=self.update_cost).grid(row=4, column=1, sticky="w")
        ttk.Label(mod, text="(несколько вариантов: ref_1.png… — лучший переименуйте в ref.png)", foreground="#666").grid(row=4, column=1, columnspan=3, sticky="e")
        mod.columnconfigure(1, weight=1)
        self.img_combo.bind("<<ComboboxSelected>>", lambda e: self.update_cost())
        self.vid_combo.bind("<<ComboboxSelected>>", lambda e: self.on_vid_model())

        self.sel = ttk.Frame(root)
        self.sel.pack(fill="x", **pad)
        self.chars: dict[str, tk.BooleanVar] = {}
        self.reacts: dict[str, tk.BooleanVar] = {}
        self.build_sel()

        act = ttk.Frame(root)
        act.pack(fill="x", **pad)
        self.cost_lbl = ttk.Label(act, text="", font=("Segoe UI", 10, "bold"))
        self.cost_lbl.pack(side="top", anchor="w")
        self.b_img = ttk.Button(act, text="1. Только эталоны (картинки)", command=lambda: self.start(images=True, videos=False))
        self.b_vid = ttk.Button(act, text="2. Видео из готовых эталонов", command=lambda: self.start(images=False, videos=True))
        self.b_all = ttk.Button(act, text="Всё сразу", command=lambda: self.start(images=True, videos=True))
        self.b_stop = ttk.Button(act, text="Стоп", command=self.do_stop, state="disabled")
        self.b_open = ttk.Button(act, text="Открыть папку", command=self.open_dir)
        for b in (self.b_img, self.b_vid, self.b_all, self.b_stop, self.b_open):
            b.pack(side="left", padx=(0, 6), pady=4)
        self.parallel = tk.IntVar(value=int(self.cfg.get("parallel", 3)))
        ttk.Label(act, text="одновременно видео:").pack(side="left", padx=(10, 2))
        ttk.Spinbox(act, from_=1, to=5, textvariable=self.parallel, width=3).pack(side="left")

        self.prog = ttk.Progressbar(root, mode="determinate")
        self.prog.pack(fill="x", **pad)
        self.logbox = tk.Text(root, height=16, wrap="word", font=("Consolas", 9))
        self.logbox.pack(fill="both", expand=True, **pad)
        self.hint = ttk.Label(root, text=f"Промпты можно править в {prompts_file(self.set_id)}", foreground="#666")
        self.hint.pack(anchor="w", padx=8, pady=(0, 6))

        self.on_vid_model(initial=True)
        self.apply_mode()
        root.after(150, self.pump)
        root.protocol("WM_DELETE_WINDOW", self.on_close)

    # ---------------------------------------------------------------- наборы

    def saved_sel(self) -> dict:
        """Отмеченные персонажи и действия набора (в старом конфиге — общий список, это набор игроков)."""
        d = (self.cfg.get("sel") or {}).get(self.set_id)
        if d is None and self.set_id == "players":
            d = {"chars": self.cfg.get("chars"), "reacts": self.cfg.get("reacts")}
        return d or {}

    def images_only(self) -> bool:
        return bool(P.SETS[self.set_id].get("images_only"))

    def apply_mode(self):
        """У наборов только из картинок нет видео: кнопки и настройки видео выключены."""
        img = self.images_only()
        for b in (self.b_vid, self.b_all):
            b.configure(state="disabled" if self.busy or img else "normal")
        self.b_img.configure(text="Картинки" if img else "1. Только эталоны (картинки)")
        self.vid_combo.configure(state="disabled" if img else "readonly")
        self.res.configure(state="disabled" if img else "readonly")
        self.dur_spin.configure(state="disabled" if img else "normal")

    def build_sel(self):
        for w in self.sel.winfo_children():
            w.destroy()
        saved = self.saved_sel()
        off = P.SETS[self.set_id]["off"]
        chars = ttk.LabelFrame(self.sel, text="Картинки" if self.images_only() else "Персонажи")
        chars.pack(side="left", fill="both", expand=True, padx=(0, 4))
        self.chars = {}
        for i, (cid, item) in enumerate(self.prompts["characters"].items()):
            name = item[0]
            v = tk.BooleanVar(value=(cid in saved["chars"]) if saved.get("chars") else True)
            self.chars[cid] = v
            ttk.Checkbutton(chars, text=f"{name} ({cid})", variable=v, command=self.update_cost).grid(row=i // 2, column=i % 2, sticky="w")
        self.reacts = {}
        if self.images_only():
            return
        reacts = ttk.LabelFrame(self.sel, text="Реакции" if self.set_id == "players" else "Действия")
        reacts.pack(side="left", fill="both", expand=True, padx=(4, 0))
        for i, (rid, (name, _)) in enumerate(self.prompts["reactions"].items()):
            v = tk.BooleanVar(value=(rid in saved["reacts"]) if saved.get("reacts") else rid not in off)
            self.reacts[rid] = v
            ttk.Checkbutton(reacts, text=f"{name} ({rid})", variable=v, command=self.update_cost).grid(row=i // 2, column=i % 2, sticky="w")

    def remember_sel(self):
        self.cfg.setdefault("sel", {})[self.set_id] = {
            "chars": [k for k, v in self.chars.items() if v.get()],
            "reacts": [k for k, v in self.reacts.items() if v.get()],
        }

    def on_set(self):
        if self.busy:
            self.set_combo.current(list(P.SETS).index(self.set_id))
            return
        self.remember_sel()
        self.set_id = list(P.SETS)[max(0, self.set_combo.current())]
        self.prompts = load_prompts(self.set_id)
        self.build_sel()
        self.apply_mode()
        self.hint.configure(text=f"Промпты можно править в {prompts_file(self.set_id)}")
        self.update_cost()

    # ---------------------------------------------------------------- настройки

    def load_cfg(self) -> dict:
        try:
            with open(CONFIG, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def save_cfg(self):
        self.remember_sel()
        cfg = {
            "out": self.out.get(),
            "img_model": self.img_id(),
            "vid_model": self.vid_id(),
            "res": self.res.get(),
            "dur": self.safe_int(self.dur, 5),
            "variants": self.safe_int(self.variants, 1),
            "parallel": self.safe_int(self.parallel, 3),
            "set": self.set_id,
            "sel": self.cfg.get("sel", {}),
        }
        if self.remember.get():
            cfg["key"] = self.key.get().strip()
        try:
            with open(CONFIG, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
        except OSError:
            pass

    @staticmethod
    def safe_int(v: tk.Variable, d: int) -> int:
        try:
            return int(v.get())
        except (tk.TclError, ValueError):
            return d

    def img_id(self) -> str:
        return list(IMAGE_MODELS)[max(0, self.img_combo.current())]

    def vid_id(self) -> str:
        return list(VIDEO_MODELS)[max(0, self.vid_combo.current())]

    def on_vid_model(self, initial=False):
        m = VIDEO_MODELS[self.vid_id()]
        res = list(m["per_s"])
        self.res.configure(values=res)
        want = self.cfg.get("res") if initial else None
        self.res.set(want if want in res else res[0])
        self.res.bind("<<ComboboxSelected>>", lambda e: self.update_cost())
        lo, hi = m["dur"]
        self.dur_spin.configure(from_=lo, to=hi)
        self.dur.set(min(hi, max(lo, self.safe_int(self.dur, 5))))
        if m["last"]:
            self.last_chk.state(["!disabled"])
            self.last.set(True)
        else:
            self.last.set(False)
            self.last_chk.state(["disabled"])
        self.update_cost()

    def selection(self):
        return [k for k, v in self.chars.items() if v.get()], [k for k, v in self.reacts.items() if v.get()]

    def update_cost(self):
        chars, reacts = self.selection()
        m = VIDEO_MODELS[self.vid_id()]
        per_s = m["per_s"].get(self.res.get(), list(m["per_s"].values())[0])
        dur = self.safe_int(self.dur, 5)
        frames = 2 if self.last.get() else 1
        n_vid = 0 if self.images_only() else len(chars) * len(reacts)
        img = len(chars) * self.safe_int(self.variants, 1) * IMAGE_MODELS[self.img_id()]["price"]
        vid = n_vid * (per_s * dur + m["per_image"] * frames)
        if self.images_only():
            n = len(chars) * self.safe_int(self.variants, 1)
            self.cost_lbl.configure(text=f"Оценка: {n} картинок ≈ {img:.0f} ₽ (уже готовые файлы пропускаются)")
            return
        self.cost_lbl.configure(
            text=f"Оценка: эталоны {img:.0f} ₽ + видео {n_vid} шт × {dur} с ≈ {vid:.0f} ₽ — итого ≈ {img + vid:.0f} ₽ "
            f"(уже готовые файлы пропускаются)"
        )

    def pick_dir(self):
        d = filedialog.askdirectory(initialdir=self.out.get())
        if d:
            self.out.set(d)

    def open_dir(self):
        os.makedirs(self.out.get(), exist_ok=True)
        os.startfile(self.out.get())  # type: ignore[attr-defined]

    # ---------------------------------------------------------------- журнал

    def log(self, s: str):
        self.q.put(("log", s))

    def pump(self):
        try:
            while True:
                kind, val = self.q.get_nowait()
                if kind == "log":
                    self.logbox.insert("end", val + "\n")
                    self.logbox.see("end")
                elif kind == "prog":
                    done, total = val
                    self.prog.configure(maximum=max(1, total), value=done)
                elif kind == "done":
                    self.set_busy(False)
        except queue.Empty:
            pass
        self.root.after(150, self.pump)

    def set_busy(self, b: bool):
        self.busy = b
        self.b_img.configure(state="disabled" if b else "normal")
        self.b_stop.configure(state="normal" if b else "disabled")
        self.apply_mode()

    def do_stop(self):
        self.stop.set()
        self.log("Останавливаю: новые задачи не запускаются, текущие прерываются…")

    def on_close(self):
        self.save_cfg()
        self.stop.set()
        self.root.destroy()

    # ---------------------------------------------------------------- работа

    def start(self, images: bool, videos: bool):
        key = self.key.get().strip()
        if not key:
            messagebox.showwarning("Ключ", "Впишите ключ API routerai.ru (routerai.ru/settings/keys).")
            return
        chars, reacts = self.selection()
        if not chars or (videos and not reacts):
            messagebox.showwarning("Выбор", "Отметьте персонажей и реакции.")
            return
        if videos and self.images_only():
            return
        self.save_cfg()
        self.stop.clear()
        self.set_busy(True)
        job = dict(
            key=key,
            out=self.out.get(),
            img_model=self.img_id(),
            vid_model=self.vid_id(),
            res=self.res.get(),
            dur=self.safe_int(self.dur, 5),
            last=self.last.get(),
            variants=self.safe_int(self.variants, 1),
            parallel=self.safe_int(self.parallel, 3),
            chars=chars,
            reacts=reacts,
            set_id=self.set_id,
            flat=self.images_only(),
            images=images,
            videos=videos,
        )
        threading.Thread(target=self.run, args=(job,), daemon=True).start()

    def spend(self, out: str, what: str, model: str, cost: float):
        with self.cost_lock:
            self.spent += cost
            path = os.path.join(out, "costs.csv")
            new = not os.path.exists(path)
            with open(path, "a", newline="", encoding="utf-8") as f:
                w = csv.writer(f, delimiter=";")
                if new:
                    w.writerow(["время", "файл", "модель", "₽"])
                w.writerow([time.strftime("%Y-%m-%d %H:%M:%S"), what, model, f"{cost:.2f}"])

    def run(self, j: dict):
        out = j["out"]
        os.makedirs(out, exist_ok=True)
        logf = open(os.path.join(out, "log.txt"), "a", encoding="utf-8")

        def log(s: str):
            line = time.strftime("%H:%M:%S ") + s
            self.log(line)
            logf.write(line + "\n")
            logf.flush()

        self.spent = 0.0
        pr = self.prompts
        tasks_total = (len(j["chars"]) if j["images"] else 0) + (len(j["chars"]) * len(j["reacts"]) if j["videos"] else 0)
        done = [0]

        def tick():
            done[0] += 1
            self.q.put(("prog", (done[0], tasks_total)))

        self.q.put(("prog", (0, tasks_total)))
        try:
            # 1. эталоны
            if j["images"]:
                for cid in j["chars"]:
                    if self.stop.is_set():
                        break
                    item = pr["characters"][cid]
                    name, person = item[0], item[1]
                    aspect = item[2] if len(item) > 2 else "1:1"
                    # аркады: все картинки набора в одной папке, файл — по id
                    d = os.path.join(out, j["set_id"] if j["flat"] else cid)
                    os.makedirs(d, exist_ok=True)
                    stem = cid if j["flat"] else "ref"
                    ref = os.path.join(d, f"{stem}.png")
                    if os.path.exists(ref):
                        log(f"{name}: уже есть — пропускаю")
                        tick()
                        continue
                    n = j["variants"]
                    for i in range(n):
                        if self.stop.is_set():
                            break
                        target = ref if n == 1 else os.path.join(d, f"{stem}_{i + 1}.png")
                        if os.path.exists(target):
                            continue
                        log(f"{name}: картинка{'' if n == 1 else f' {i + 1}/{n}'} ({j['img_model']}, {aspect})…")
                        try:
                            img, cost = gen_image(j["key"], j["img_model"], pr["image"].format(person=person), seed=None, aspect=aspect)
                            with open(target, "wb") as f:
                                f.write(img)
                            self.spend(out, os.path.relpath(target, out), j["img_model"], cost)
                            log(f"   готово: {os.path.relpath(target, out)} ({cost:.2f} ₽)")
                        except ApiError as e:
                            log(f"   ОШИБКА: {e}")
                            if "HTTP 401" in str(e) or "HTTP 402" in str(e):
                                raise
                    if n > 1 and not os.path.exists(ref):
                        log(f"   {name}: выберите лучший вариант и переименуйте его в {stem}.png")
                    tick()
            # 2. видео
            if j["videos"] and not self.stop.is_set():
                jobs = []
                for cid in j["chars"]:
                    name = pr["characters"][cid][0]
                    ref = os.path.join(out, cid, "ref.png")
                    if not os.path.exists(ref):
                        log(f"{name}: нет {cid}/ref.png — видео пропущены")
                        for _ in j["reacts"]:
                            tick()
                        continue
                    for rid in j["reacts"]:
                        jobs.append((cid, rid))

                def one(cid: str, rid: str):
                    if self.stop.is_set():
                        return
                    name = pr["characters"][cid][0]
                    rname, action = pr["reactions"][rid]
                    target = os.path.join(out, cid, f"{cid}_{rid}.mp4")
                    if os.path.exists(target):
                        log(f"{name} — {rname}: уже есть")
                        tick()
                        return
                    with open(os.path.join(out, cid, "ref.png"), "rb") as f:
                        ref = f.read()
                    log(f"{name} — {rname}: видео ({j['vid_model']}, {j['dur']} с, {j['res']})…")
                    try:
                        mp4, cost = gen_video(j["key"], j["vid_model"], pr["video"].format(action=action), ref, j["dur"], j["res"], j["last"], self.stop, log)
                        with open(target, "wb") as f:
                            f.write(mp4)
                        self.spend(out, os.path.relpath(target, out), j["vid_model"], cost)
                        log(f"   готово: {os.path.relpath(target, out)} ({cost:.2f} ₽)")
                    except ApiError as e:
                        log(f"   {name} — {rname}: ОШИБКА: {e}")
                    tick()

                with ThreadPoolExecutor(max_workers=max(1, j["parallel"])) as ex:
                    for cid, rid in jobs:
                        ex.submit(one, cid, rid)
        except ApiError as e:
            log(f"Стоп: {e}")
        except Exception as e:  # неожиданное — в журнал, окно не падает
            log(f"Сбой: {e!r}")
        log(f"Готово. Потрачено за запуск: {self.spent:.2f} ₽ (подробно — costs.csv).")
        logf.close()
        self.q.put(("done", None))


def main():
    root = tk.Tk()
    try:
        ttk.Style().theme_use("vista")
    except tk.TclError:
        pass
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
