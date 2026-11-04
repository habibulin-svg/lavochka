import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flushGeroiMail, geroiMailOf, initGeroiMail } from '../../server/geroi';
import type { MapServerMsg } from '../../src/geroi/net/mapproto';
import { MapRoom, type MapPeer } from '../../src/geroi/net/maproom';

const peer = (id: number, token: string, user: number): MapPeer => ({ id, name: token, token, user, send: (m: MapServerMsg) => void m });

describe('geroi/mailstore: партии по переписке на диске', () => {
  it('файл партии поднимается при старте, виден в «Мои партии», испорченный откладывается', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geroi-mail-'));
    try {
      const room = new MapRoom({ template: 'duel', size: 's', water: 'lakes', guard: 'normal', seed: 9 });
      const a = peer(1, 'a', 101);
      const b = peer(2, 'b', 202);
      room.add(a);
      room.add(b);
      room.message(a, { t: 'mmail', on: true });
      room.message(a, { t: 'start' });
      mkdirSync(join(dir, 'geroi-mail'), { recursive: true });
      writeFileSync(join(dir, 'geroi-mail', 'MAIL01.json'), JSON.stringify(room.save()));
      writeFileSync(join(dir, 'geroi-mail', 'BROKEN.json'), '{не json');
      initGeroiMail(dir, undefined, () => {});
      const mine = geroiMailOf(101);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ code: 'MAIL01', seat: 0, over: false });
      expect(geroiMailOf(202)[0]).toMatchObject({ code: 'MAIL01', seat: 1 });
      expect(geroiMailOf(303)).toEqual([]);
      expect(readdirSync(join(dir, 'geroi-mail'))).toContain('BROKEN.json.bad');
      // выключение: файл переписан тем же
      flushGeroiMail();
      expect(readdirSync(join(dir, 'geroi-mail'))).toContain('MAIL01.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
