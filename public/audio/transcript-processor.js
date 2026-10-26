/* global AudioWorkletProcessor, registerProcessor, sampleRate */
class TranscriptProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.parts = [];
    this.length = 0;
    this.voiced = false;
    this.quiet = 0;
    this.levelFrames = 0;
    this.port.onmessage = event => {
      if (event.data === "flush") {
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }
  flush() {
    if (this.voiced && this.length >= sampleRate * 0.25) {
      const samples = new Float32Array(this.length);
      let offset = 0;
      for (const part of this.parts) { samples.set(part, offset); offset += part.length; }
      this.port.postMessage({ type: "chunk", samples }, [samples.buffer]);
    }
    this.parts = []; this.length = 0; this.voiced = false; this.quiet = 0;
  }
  process(inputs) {
    const data = inputs[0]?.[0];
    if (!data?.length) return true;
    let energy = 0;
    for (const value of data) energy += value * value;
    const speaking = Math.sqrt(energy / data.length) > 0.006;
    this.levelFrames += data.length;
    if (this.levelFrames >= sampleRate / 4) {
      this.port.postMessage({ type: "level", speaking }); this.levelFrames = 0;
    }
    this.parts.push(new Float32Array(data)); this.length += data.length;
    if (speaking) { this.voiced = true; this.quiet = 0; }
    else this.quiet += data.length;
    if (!this.voiced) {
      while (this.length > sampleRate * 0.25 && this.parts.length > 1) this.length -= this.parts.shift().length;
    } else if (this.length >= sampleRate * 8 || (this.quiet >= sampleRate * 0.6 && this.length >= sampleRate)) {
      this.flush();
    }
    return true;
  }
}
registerProcessor("debate-transcript", TranscriptProcessor);
