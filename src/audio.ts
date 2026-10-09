/** Browser-only PCM audio helpers for the Gemini Live gateway. */
export function toPCM(samples: Float32Array, sourceRate: number, targetRate = 16000): string {
  const ratio = sourceRate / targetRate;
  const outputLength = Math.floor(samples.length / ratio);
  const pcm = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const begin = Math.floor(i * ratio), end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let average = 0;
    const count = Math.max(1, end - begin);
    for (let j = begin; j < end; j++) average += samples[j];
    const value = Math.max(-1, Math.min(1, average / count));
    pcm[i] = value < 0 ? value * 32768 : value * 32767;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export class PCMPlayer {
  private context: AudioContext | null = null;
  private cursor = 0;
  private nodes = new Set<AudioBufferSourceNode>();
  async unlock() {
    if (!this.context) this.context = new AudioContext({ sampleRate: 24000 });
    await this.context.resume();
  }
  play(base64: string) {
    const ctx = this.context;
    if (!ctx) return;
    try {
      const raw = atob(base64);
      if (raw.length < 2 || raw.length % 2) return;
      const view = new DataView(new ArrayBuffer(raw.length));
      for (let i = 0; i < raw.length; i++) view.setUint8(i, raw.charCodeAt(i));
      const samples = new Float32Array(raw.length / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
      const audioBuffer = ctx.createBuffer(1, samples.length, 24000);
      audioBuffer.copyToChannel(samples, 0);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      const start = Math.max(ctx.currentTime + 0.03, this.cursor);
      source.start(start);
      this.cursor = start + audioBuffer.duration;
      this.nodes.add(source);
      source.onended = () => this.nodes.delete(source);
    } catch { /* Invalid chunk; playback continues on next good chunk */ }
  }
  interrupt() {
    for (const node of this.nodes) { try { node.stop(); } catch { /* ended */ } }
    this.nodes.clear();
    this.cursor = this.context?.currentTime || 0;
  }
  async close() {
    this.interrupt();
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
  }
}

export class PCMMicrophone {
  private media: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;

  async start(onChunk: (pcm: string) => void, onLevel: (level: number) => void) {
    this.media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.context = new AudioContext();
    await this.context.resume();
    this.source = this.context.createMediaStreamSource(this.media);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.sink = this.context.createGain();
    this.sink.gain.value = 0; // Do not play mic output to speakers.
    this.processor.onaudioprocess = (event) => {
      const samples = event.inputBuffer.getChannelData(0);
      let energy = 0;
      for (let i = 0; i < samples.length; i += 8) energy += samples[i] * samples[i];
      onLevel(Math.min(1, Math.sqrt(energy / Math.max(1, samples.length / 8)) * 6));
      onChunk(toPCM(samples, this.context!.sampleRate));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.sink);
    this.sink.connect(this.context.destination);
  }
  stop() {
    if (this.processor) { this.processor.onaudioprocess = null; this.processor.disconnect(); }
    this.source?.disconnect();
    this.sink?.disconnect();
    this.media?.getTracks().forEach(t => t.stop());
    if (this.context) void this.context.close().catch(() => {});
    this.media = null; this.context = null; this.source = null; this.processor = null; this.sink = null;
  }
}
