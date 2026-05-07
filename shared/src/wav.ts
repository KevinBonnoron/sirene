// Minimal RIFF/WAVE header for 16-bit mono PCM. Both the API (server-side
// streaming) and the browser client (PCM accumulation) wrap the same raw
// inference output, so the header writer lives in shared to keep the two
// sides byte-for-byte identical.

const HEADER_SIZE = 44;

/** Drain a `ReadableStream<Uint8Array>` into a chunk list + total byte count.
 *  Used by both sides to accumulate raw PCM from the inference worker before
 *  prepending a WAV header. */
export async function readPcmStream(stream: ReadableStream<Uint8Array>): Promise<{ chunks: Uint8Array[]; totalBytes: number }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    totalBytes += value.length;
  }
  return { chunks, totalBytes };
}

/** Build a 16-bit mono PCM WAV from a list of raw PCM chunks. */
export function buildWav(chunks: Uint8Array[], totalBytes: number, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_SIZE + totalBytes);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + totalBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, totalBytes, true);

  const out = new Uint8Array(buffer, HEADER_SIZE);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return buffer;
}
