export function encodeWav(input: Float32Array, inputRate: number): Uint8Array<ArrayBuffer> {
  const rate = 16000;
  const size = Math.floor(input.length * rate / inputRate);
  const buffer = new ArrayBuffer(44 + size * 2);
  const view = new DataView(buffer);
  const word = (offset: number, text: string) => Array.from(text).forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  word(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); word(8, "WAVE");
  word(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, "data"); view.setUint32(40, size * 2, true);
  for (let index = 0; index < size; index++) {
    const start = index * inputRate / rate;
    const end = Math.min(input.length, (index + 1) * inputRate / rate);
    let value = 0;
    let weight = 0;
    for (let source = Math.floor(start); source < end; source++) {
      const overlap = Math.min(source + 1, end) - Math.max(source, start);
      value += input[source] * overlap; weight += overlap;
    }
    const sample = Math.max(-1, Math.min(1, weight ? value / weight : 0));
    view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Uint8Array(buffer);
}
