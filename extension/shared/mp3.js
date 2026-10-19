// @ts-check
/** PCM to MP3 with lamejs (passed in, so this file also runs under Node tests). */

/**
 * @param {any} lamejs the lamejs global
 * @param {{numberOfChannels: number, sampleRate: number, length: number, getChannelData: (c: number) => Float32Array}} audio
 * @param {number} kbps
 * @returns {Uint8Array}
 */
export function encodeMp3(lamejs, audio, kbps) {
  // Mix down to mono.
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels;
  }
  const pcm = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const encoder = new lamejs.Mp3Encoder(1, audio.sampleRate, kbps);
  /** @type {Int8Array[]} */
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const out = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
    if (out.length) parts.push(out);
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(tail);
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    result.set(new Uint8Array(p.buffer, p.byteOffset, p.length), offset);
    offset += p.length;
  }
  return result;
}
