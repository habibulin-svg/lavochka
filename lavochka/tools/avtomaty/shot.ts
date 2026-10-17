/* Кадр автомата без браузера: npx tsx tools/avtomaty/shot.ts <id> <секунд> [монета на секунде] [out.png]
 * Монета — импульс 0,1 с; потом через секунду жмём b1 (старт у многих игр). */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { TiaMc1 } from '../../src/arcade/tiamc1';
import { Photon } from '../../src/arcade/photon';
import { Photon2 } from '../../src/arcade/photon2';
import type { ArcadeMachine } from '../../src/arcade/machine';

const [id, secS = '10', coinS = '', out = `../scratch-${process.argv[2]}.png`] = process.argv.slice(2);
const img = new Uint8Array(readFileSync(`public/avtomaty/${id}.bin`));
const m: ArcadeMachine = id === 'black' || id === 'brod' ? new Photon2(img) : id.startsWith('ph') ? new Photon(img) : new TiaMc1(img, id === 'kot' ? 'kot' : id === 'gorodki' ? 'gorodki' : 'tia');
const fps = 50;
const frames = Math.round(Number(secS) * fps);
const coinAt = coinS ? Math.round(Number(coinS) * fps) : -1;
for (let f = 0; f < frames; f++) {
  m.set('coin', f >= coinAt && f < coinAt + 5 && coinAt >= 0);
  m.set('b1', coinAt >= 0 && f >= coinAt + 50 && f < coinAt + 60);
  m.run(m.cpuHz / fps, null);
}
// PNG
const W = m.width, H = m.height;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const p = m.frame[y * W + x];
    const o = y * (W * 4 + 1) + 1 + x * 4;
    raw[o] = p & 255; raw[o + 1] = (p >> 8) & 255; raw[o + 2] = (p >> 16) & 255; raw[o + 3] = 255;
  }
}
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(id, '->', out);
