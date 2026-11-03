"""Шина событий для интерфейса (Server-Sent Events): запуски, шаги, загрузки, сервисы, железо."""
import json
import queue
import threading
import time

_subs: list[queue.Queue] = []
_lock = threading.Lock()


def subscribe() -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=2000)
    with _lock:
        _subs.append(q)
    return q


def unsubscribe(q: queue.Queue):
    with _lock:
        if q in _subs:
            _subs.remove(q)


def publish(kind: str, data):
    msg = json.dumps({'type': kind, 'data': data, 't': time.time()}, ensure_ascii=False, default=str)
    with _lock:
        subs = list(_subs)
    for q in subs:
        try:
            q.put_nowait(msg)
        except queue.Full:       # медленный клиент — выкидываем старое, интерфейс перечитает состояние
            try:
                q.get_nowait()
                q.put_nowait(msg)
            except queue.Empty:
                pass
