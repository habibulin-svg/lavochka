// Упаковка пакетов Opus в контейнер Ogg (RFC 3533 + RFC 7845) — для сведения трека в .ogg без сервера.
// Пакеты даёт WebCodecs AudioEncoder; здесь только заголовки, страницы, гранулы и CRC. Без DOM — проверяется тестом.

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** CRC-32 Ogg (полином 0x04c11db7, без отражения, начальное 0). */
export function oggCrc(b: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < b.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ b[i]) & 0xff]) >>> 0;
  return c >>> 0;
}

/** Заголовок OpusHead: каналы, pre-skip, исходная частота. */
export function opusHead(channels: number, preSkip: number, rate: number): Uint8Array {
  const b = new Uint8Array(19);
  const v = new DataView(b.buffer);
  b.set([...'OpusHead'].map(c => c.charCodeAt(0)));
  b[8] = 1;
  b[9] = channels;
  v.setUint16(10, preSkip, true);
  v.setUint32(12, rate, true);
  v.setInt16(16, 0, true);
  b[18] = 0;
  return b;
}

export function opusTags(vendor: string, comments: string[] = []): Uint8Array {
  const enc = new TextEncoder();
  const parts = [enc.encode('OpusTags')];
  const u32 = (n: number) => {
    const x = new Uint8Array(4);
    new DataView(x.buffer).setUint32(0, n, true);
    return x;
  };
  const vs = enc.encode(vendor);
  parts.push(u32(vs.length), vs, u32(comments.length));
  for (const c of comments) {
    const cs = enc.encode(c);
    parts.push(u32(cs.length), cs);
  }
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Одна страница Ogg из целых пакетов (сегментов не больше 255). */
export function oggPage(packets: Uint8Array[], granule: bigint, serial: number, seq: number, flags: number): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  if (lacing.length > 255) throw new Error('слишком много сегментов на странице');
  const head = new Uint8Array(27 + lacing.length);
  const v = new DataView(head.buffer);
  head.set([0x4f, 0x67, 0x67, 0x53]); // OggS
  head[4] = 0;
  head[5] = flags;
  v.setBigInt64(6, granule, true);
  v.setUint32(14, serial, true);
  v.setUint32(18, seq, true);
  v.setUint32(22, 0, true);
  head[26] = lacing.length;
  head.set(lacing, 27);
  const page = concat([head, ...packets]);
  new DataView(page.buffer).setUint32(22, oggCrc(page), true);
  return page;
}

const segs = (p: Uint8Array) => Math.floor(p.length / 255) + 1;

/**
 * Собрать файл Ogg Opus.
 * @param packets пакеты Opus по порядку и их длительность в отсчётах 48 кГц
 * @param total сколько отсчётов 48 кГц в треке (без pre-skip) — по нему конец последней страницы обрезает лишнее
 */
export function muxOggOpus(packets: { data: Uint8Array; samples: number }[], opts: { channels: number; preSkip: number; rate: number; total: number; serial?: number; vendor?: string }): Uint8Array {
  const serial = opts.serial ?? 0x6c61766f; // «lavo»
  const pages: Uint8Array[] = [];
  let seq = 0;
  pages.push(oggPage([opusHead(opts.channels, opts.preSkip, opts.rate)], 0n, serial, seq++, 0x02));
  pages.push(oggPage([opusTags(opts.vendor ?? 'Lavochka Music Studio')], 0n, serial, seq++, 0));
  const end = BigInt(opts.preSkip + opts.total);
  let granule = 0n;
  let cur: Uint8Array[] = [];
  let curSegs = 0;
  let curSamples = 0;
  const flush = (last: boolean) => {
    if (!cur.length) return;
    let gp = granule;
    if (last && gp > end) gp = end;
    pages.push(oggPage(cur, gp, serial, seq++, last ? 0x04 : 0));
    cur = [];
    curSegs = 0;
    curSamples = 0;
  };
  packets.forEach((p, i) => {
    if (cur.length && (curSegs + segs(p.data) > 255 || curSamples >= 48000)) flush(false);
    cur.push(p.data);
    curSegs += segs(p.data);
    curSamples += p.samples;
    granule += BigInt(p.samples);
    if (i === packets.length - 1) flush(true);
  });
  return concat(pages);
}
