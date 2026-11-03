"""Чтение шапки GGUF: архитектура, слои, головы внимания — для точного расчёта кэша контекста и раскладки по картам."""
import struct

_SCALAR = {0: '<B', 1: '<b', 2: '<H', 3: '<h', 4: '<I', 5: '<i', 6: '<f', 7: '<?', 10: '<Q', 11: '<q', 12: '<d'}


def _read(f, fmt):
    n = struct.calcsize(fmt)
    return struct.unpack(fmt, f.read(n))[0]


def _str(f):
    n = _read(f, '<Q')
    return f.read(n).decode('utf-8', errors='replace')


def _value(f, t, keep=True):
    if t in _SCALAR:
        return _read(f, _SCALAR[t])
    if t == 8:
        return _str(f)
    if t == 9:
        et, n = _read(f, '<I'), _read(f, '<Q')
        small = keep and n <= 4096 and et != 8
        if et in _SCALAR and not small:      # большой числовой массив — пропустить целиком
            f.seek(struct.calcsize(_SCALAR[et]) * n, 1)
            return None
        vals = [_value(f, et, keep=False) for _ in range(n)]
        return vals if small else None
    raise ValueError(f'неизвестный тип GGUF {t}')


def metadata(path: str) -> dict:
    with open(path, 'rb') as f:
        if f.read(4) != b'GGUF':
            raise ValueError('не GGUF')
        version = _read(f, '<I')
        _tensors, kv = _read(f, '<Q'), _read(f, '<Q')
        meta = {'gguf.version': version}
        for _ in range(kv):
            key = _str(f)
            t = _read(f, '<I')
            v = _value(f, t)
            if v is not None:
                meta[key] = v
    return meta


def summary(path: str) -> dict:
    """Главное для советника: слои, контекст, кэш на токен (байт при q8_0), эксперты."""
    m = metadata(path)
    arch = m.get('general.architecture', '?')
    g = lambda k, d=None: m.get(f'{arch}.{k}', d)  # noqa: E731
    layers = int(g('block_count', 0) or 0)
    heads = g('attention.head_count', 0)
    kv_heads = g('attention.head_count_kv', heads)
    emb = int(g('embedding_length', 0) or 0)
    head_count = heads if isinstance(heads, int) else max(heads or [1])
    key_len = int(g('attention.key_length', 0) or (emb // head_count if head_count else 0))
    val_len = int(g('attention.value_length', 0) or key_len)
    per_layer = kv_heads if isinstance(kv_heads, list) else [kv_heads or 0] * layers
    # гибридные модели (часть слоёв — линейное внимание) пишут интервал полного внимания
    interval = g('full_attention_interval')
    if interval and not isinstance(kv_heads, list):
        per_layer = [kv_heads if (i + 1) % int(interval) == 0 else 0 for i in range(layers)]
    kv_bytes_tok = sum(h * (key_len + val_len) for h in per_layer) * 1.0625   # q8_0 ≈ 8,5 бит
    return {
        'arch': arch, 'name': m.get('general.name'), 'layers': layers, 'ctx_train': g('context_length'),
        'embedding': emb, 'experts': g('expert_count'), 'experts_used': g('expert_used_count'),
        'kv_bytes_per_token_q8': int(kv_bytes_tok), 'file_type': m.get('general.file_type'),
    }
