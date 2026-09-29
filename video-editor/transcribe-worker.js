// Speech to text for the audio editor: Whisper (transformers.js) running in this worker, in the browser.
// The model is downloaded once from Hugging Face and then cached by the browser; the audio never leaves the device.
// Message in: { id, audio: Float32Array (16 kHz mono), model, language, words }
// Messages out: { id, progress: { file, loaded, total, status } } · { id, status } · { id, out } · { id, error }
const TF_SOURCES = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js',
  'https://unpkg.com/@huggingface/transformers@4.3.0/dist/transformers.min.js',
];
let tf = null, pipe = null, pipeModel = '';

async function loadLib() {
  if (tf) return tf;
  let err;
  for (const u of TF_SOURCES) { try { tf = await import(u); return tf; } catch (e) { err = e; } }
  throw err || new Error('Could not load the speech recogniser');
}

async function getPipe(id, model) {
  if (pipe && pipeModel === model) return pipe;
  const { pipeline } = await loadLib();
  const progress_callback = p => postMessage({ id, progress: p });
  let device = 'wasm';
  try { if (self.navigator && navigator.gpu && await navigator.gpu.requestAdapter()) device = 'webgpu'; } catch (e) {}
  try { pipe = await pipeline('automatic-speech-recognition', model, { device, progress_callback }); }
  catch (e) { if (device === 'wasm') throw e; pipe = await pipeline('automatic-speech-recognition', model, { device: 'wasm', progress_callback }); }
  pipeModel = model;
  return pipe;
}

self.onmessage = async e => {
  const { id, audio, model, language, words } = e.data;
  try {
    const p = await getPipe(id, model);
    postMessage({ id, status: 'listening' });
    const opts = { chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', return_timestamps: words ? 'word' : true };
    if (language) opts.language = language;
    let out;
    try { out = await p(audio, opts); }
    catch (err) { if (!words) throw err; opts.return_timestamps = true; out = await p(audio, opts); } // model without word timings
    postMessage({ id, out: { text: out.text, chunks: out.chunks || [] } });
  } catch (err) { postMessage({ id, error: String(err && err.message || err) }); }
};
