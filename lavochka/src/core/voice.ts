/* Голосовой чат за сетевым столом: каждый с каждым по WebRTC (голос и, по желанию, маленькое видео с камеры).
 * Комната только пересылает сигналы (предложения, ответы, ICE-кандидаты) — сами голос и картинка идут напрямую между браузерами.
 * Согласование — «perfect negotiation»: вежливая сторона (больший clientId) уступает при столкновении предложений.
 * Тишина (ночь в мафии): свой микрофон и камера выключаются, пока игра не разрешит. */
import type { RoomClient } from './client';
import type { RoomMsg, VoiceMember } from './protocol';

const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  making: boolean;
  ignore: boolean;
  stream: MediaStream | null;
  level: number;
  analyser: AnalyserNode | null;
}

export interface VoiceTile {
  id: string;
  name: string;
  seat: number | null;
  me: boolean;
  stream: MediaStream | null;
  video: boolean;
  /** Громкость 0..1 — для подсветки говорящего. */
  level: number;
  muted: boolean;
}

export class Voice {
  private peers = new Map<string, Peer>();
  private members: VoiceMember[] = [];
  private local: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private myLevel: AnalyserNode | null = null;
  private unsub: () => void;
  private timer: ReturnType<typeof setInterval> | undefined;
  joined = false;
  micOn = true;
  camOn = false;
  /** Причина тишины (ночь) или null. */
  quiet: string | null = null;
  onChange: (() => void) | null = null;

  constructor(private client: RoomClient) {
    this.unsub = client.on((m) => this.onMsg(m));
  }

  static supported(): boolean {
    return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /** Войти в голосовой чат (спросит разрешение на микрофон, с камерой — и на неё). */
  async join(video: boolean) {
    if (this.joined) return;
    this.local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { width: { ideal: 160 }, height: { ideal: 120 }, frameRate: { ideal: 15 } } : false,
    });
    this.camOn = video;
    this.joined = true;
    this.ctx = new AudioContext();
    this.myLevel = this.analyse(this.local);
    this.applyTracks();
    this.client.voice(true, video);
    this.timer = setInterval(() => this.meter(), 150);
    this.changed();
  }

  leave() {
    if (!this.joined) return;
    this.joined = false;
    this.client.voice(false);
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
    this.changed();
  }

  setMic(on: boolean) {
    this.micOn = on;
    this.applyTracks();
    this.changed();
  }

  /** Камера: включить можно, только если вошли с ней (иначе — перезайти с камерой). */
  setCam(on: boolean) {
    this.camOn = on && !!this.local?.getVideoTracks().length;
    this.applyTracks();
    this.client.voice(true, this.camOn);
    this.changed();
  }

  setQuiet(reason: string | null) {
    if (reason === this.quiet) return;
    this.quiet = reason;
    this.applyTracks();
    this.changed();
  }

  private applyTracks() {
    if (!this.local) return;
    for (const t of this.local.getAudioTracks()) t.enabled = this.micOn && !this.quiet;
    for (const t of this.local.getVideoTracks()) t.enabled = this.camOn && !this.quiet;
  }

  tiles(): VoiceTile[] {
    const out: VoiceTile[] = [];
    for (const m of this.members) {
      const me = m.id === this.client.id;
      const p = this.peers.get(m.id);
      out.push({
        id: m.id,
        name: m.name,
        seat: m.seat,
        me,
        stream: me ? this.local : (p?.stream ?? null),
        video: m.video && !this.quiet,
        level: me ? this.level(this.myLevel) : (p?.level ?? 0),
        muted: me ? !this.micOn || !!this.quiet : false,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- сигналы

  private onMsg(m: RoomMsg) {
    if (m.t === 'voice') {
      this.members = m.members;
      if (this.joined) this.sync();
      this.changed();
    } else if (m.t === 'rtc' && this.joined) void this.signal(m.from, m.data as { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit });
  }

  /** Соединения — со всеми, кто в чате; с ушедшими — закрыть. */
  private sync() {
    const ids = new Set(this.members.map((m) => m.id).filter((id) => id !== this.client.id));
    if (!this.members.some((m) => m.id === this.client.id)) return;
    for (const id of ids) if (!this.peers.has(id)) this.openPeer(id);
    for (const id of [...this.peers.keys()]) if (!ids.has(id)) this.closePeer(id);
  }

  private openPeer(id: string) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const p: Peer = { pc, polite: this.client.id > id, making: false, ignore: false, stream: null, level: 0, analyser: null };
    this.peers.set(id, p);
    for (const t of this.local?.getTracks() ?? []) pc.addTrack(t, this.local!);
    pc.onnegotiationneeded = async () => {
      try {
        p.making = true;
        await pc.setLocalDescription();
        this.client.rtc(id, { description: pc.localDescription?.toJSON() });
      } catch (e) {
        console.warn('voice: negotiation', e);
      } finally {
        p.making = false;
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.client.rtc(id, { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      p.stream = e.streams[0] ?? new MediaStream([e.track]);
      if (this.ctx && e.track.kind === 'audio') p.analyser = this.analyse(p.stream);
      this.changed();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
      this.changed();
    };
  }

  private closePeer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    p.pc.close();
  }

  private async signal(from: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    if (!data || typeof data !== 'object') return;
    if (!this.peers.has(from)) {
      if (!this.members.some((m) => m.id === from)) return;
      this.openPeer(from);
    }
    const p = this.peers.get(from)!;
    const pc = p.pc;
    try {
      if (data.description) {
        const d = data.description;
        const collision = d.type === 'offer' && (p.making || pc.signalingState !== 'stable');
        p.ignore = !p.polite && collision;
        if (p.ignore) return;
        await pc.setRemoteDescription(d);
        if (d.type === 'offer') {
          await pc.setLocalDescription();
          this.client.rtc(from, { description: pc.localDescription?.toJSON() });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (e) {
          if (!p.ignore) throw e;
        }
      }
    } catch (e) {
      console.warn('voice: signal', e);
    }
  }

  // ---------------------------------------------------------------- громкость

  private analyse(stream: MediaStream): AnalyserNode | null {
    if (!this.ctx || !stream.getAudioTracks().length) return null;
    try {
      const a = this.ctx.createAnalyser();
      a.fftSize = 256;
      this.ctx.createMediaStreamSource(stream).connect(a);
      return a;
    } catch {
      return null;
    }
  }

  private level(a: AnalyserNode | null): number {
    if (!a) return 0;
    const buf = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / buf.length) * 4);
  }

  private meter() {
    for (const p of this.peers.values()) p.level = this.level(p.analyser);
    this.changed();
  }

  private changed() {
    this.onChange?.();
  }

  destroy() {
    this.leave();
    this.unsub();
  }
}
