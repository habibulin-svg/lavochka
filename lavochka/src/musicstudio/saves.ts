// Сохранения (3 ячейки + автосохранение) и ссылка «поделиться» (проект сжат в адресе, ничего не уходит на сервер).
import { store } from '../core/settings';
import { parseProject, serialize, type Kit, type Project } from './project';

export const SLOTS = 3;
const KEY = 'musicstudio.saves';
const AUTO = 'musicstudio.auto';

export interface SaveInfo {
  name: string;
  date: number;
  data: string;
}

export function loadSlots(): (SaveInfo | null)[] {
  const s = store.get<(SaveInfo | null)[]>(KEY, []);
  return Array.from({ length: SLOTS }, (_, i) => (s[i] && typeof s[i]!.data === 'string' ? s[i] : null));
}

export function writeSlot(i: number, p: Project): void {
  const s = loadSlots();
  s[i] = { name: p.name, date: Date.now(), data: serialize(p) };
  store.set(KEY, s);
}

export function readSlot(i: number, kit: Kit): Project | null {
  const s = loadSlots()[i];
  if (!s) return null;
  try {
    return parseProject(JSON.parse(s.data), kit);
  } catch {
    return null;
  }
}

export function autosave(p: Project): void {
  store.set(AUTO, serialize(p));
}

export function readAuto(kit: Kit): Project | null {
  const raw = store.get<string | null>(AUTO, null);
  if (!raw) return null;
  try {
    return parseProject(JSON.parse(raw), kit);
  } catch {
    return null;
  }
}

function b64(u: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Ссылка на микс: `#mix=<deflate+base64url>`. */
export async function shareLink(p: Project): Promise<string> {
  const z = await pipe(new TextEncoder().encode(serialize(p)), new CompressionStream('deflate-raw'));
  return `${location.origin}${location.pathname}#mix=${b64(z)}`;
}

export async function fromLink(hash: string, kit: Kit): Promise<Project | null> {
  const m = /mix=([\w-]+)/.exec(hash);
  if (!m) return null;
  try {
    const raw = await pipe(unb64(m[1]), new DecompressionStream('deflate-raw'));
    return parseProject(JSON.parse(new TextDecoder().decode(raw)), kit);
  } catch {
    return null;
  }
}
