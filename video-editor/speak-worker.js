// Text to speech for the video editor: Meta's MMS voices (VITS) through transformers.js, in this worker, in the browser.
// The voice downloads once from Hugging Face and is then cached by the browser; the text never leaves the device.
// Message in: { id, parts: [string], models: [candidate repo ids, tried in order] }
// Messages out: { id, progress } · { id, status, done, total } · { id, out: { parts: [Float32Array], rate, model } } · { id, error }
const TF_SOURCES = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js',
  'https://unpkg.com/@huggingface/transformers@4.3.0/dist/transformers.min.js',
];
let tf = null;
const pipes = new Map();

async function loadLib() {
  if (tf) return tf;
  let err;
  for (const u of TF_SOURCES) { try { tf = await import(u); return tf; } catch (e) { err = e; } }
  throw err || new Error('Could not load the voice library');
}

async function getPipe(id, models) {
  for (const m of models) if (pipes.has(m)) return { pipe: pipes.get(m), model: m };
  const { pipeline } = await loadLib();
  const progress_callback = p => postMessage({ id, progress: p });
  let err;
  for (const m of models) {
    try {
      const pipe = await pipeline('text-to-speech', m, { dtype: 'q8', progress_callback });
      pipes.set(m, pipe);
      return { pipe, model: m };
    } catch (e) { err = e; }
  }
  throw new Error('NO_VOICE ' + (err && err.message || ''));
}

self.onmessage = async e => {
  const { id, parts, models } = e.data;
  try {
    const { pipe, model } = await getPipe(id, models);
    const out = [];
    let rate = 16000;
    for (let i = 0; i < parts.length; i++) {
      postMessage({ id, status: 'speaking', done: i, total: parts.length });
      const r = await pipe(parts[i]);
      rate = r.sampling_rate || rate;
      out.push(r.audio instanceof Float32Array ? r.audio : Float32Array.from(r.audio));
    }
    postMessage({ id, out: { parts: out, rate, model } }, out.map(a => a.buffer));
  } catch (err) {
    postMessage({ id, error: String(err && err.message || err) });
  }
};
