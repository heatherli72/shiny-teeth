const PROGRESS_KEY = 'shiny-teeth-progress-v1';
const LAST_KEY = 'shiny-teeth-last-v1';
const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || min));
const abortError = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });

export function sanitizeProgress(value, phrases) {
  const clean = {};
  for (const id of [...phrases.map(phrase => phrase.id), '__fullsong__']) {
    if (Object.hasOwn(value ?? {}, id) && [0, 1, 2].includes(value[id])) clean[id] = value[id];
  }
  return clean;
}

export function resolveSegments(options, song, phrases, sections) {
  const byId = new Map(phrases.map(p => [p.id, p]));
  const section = options.sectionId ? sections.find(s => s.id === options.sectionId) : null;
  if (options.sectionId && !section) throw new Error('This section is unavailable. Choose another section.');
  if (options.chunkIndex != null && (!Number.isInteger(options.chunkIndex) || options.chunkIndex < 0 || options.phraseIds?.length !== 1)) throw new Error('This clip is unavailable. Choose another clip.');
  if (options.phraseIds?.length) {
    let cursor = -1;
    const segments = options.phraseIds.map(id => {
      const phrase = byId.get(id);
      if (!phrase) throw new Error('This line is unavailable. Choose another line.');
      const index = section?.occurrences?.findIndex((o, i) => i > cursor && o.phraseId === id) ?? -1;
      const occurrence = index >= 0 ? section.occurrences[index] : null;
      if (occurrence) cursor = index;
      let segment = { ...phrase, ...occurrence, phraseId: id };
      if (options.chunkIndex != null) {
        const chunk = phrase.chunks?.[options.chunkIndex];
        if (!chunk) throw new Error('This clip is unavailable. Choose another clip.');
        segment = { ...segment, ...chunk, spokenUrl: chunk.spokenUrl, sungUrl: chunk.sungUrl,
          chantUrl: chunk.chantUrl, melodyUrl: chunk.melodyUrl, chunkIndex: options.chunkIndex };
      }
      if (options.mode !== 'spoken' && options.mode !== 'chant' && options.mode !== 'melody' && (segment.songAvailable === false || typeof segment.start !== 'number' || typeof segment.end !== 'number' || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start)) {
        throw new Error('No song clip is available for this line. Try Read first.');
      }
      return segment;
    });
    const clip = (options.mode ?? 'song') === 'song' && options.chunkIndex == null && section?.practiceClips?.find(item =>
      item.audioUrl && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start &&
      item.phraseIds?.length === options.phraseIds.length && item.phraseIds.every((id, index) => id === options.phraseIds[index]));
    return clip ? [{ ...clip, sectionId: section.id, phraseId: options.phraseIds[0] }] : segments;
  }
  if (section) return [{ start: section.start, end: section.end, audioUrl: section.audioUrl, sectionId: section.id, phraseId: section.phraseIds[0] ?? null }];
  return [{ start: options.start ?? 0, end: options.end ?? song.duration, phraseId: null }];
}

class RecordingStore {
  constructor() { this.memory = new Map(); this.db = null; this.opening = null; }
  async open() {
    if (this.db) return this.db;
    if (!globalThis.indexedDB) return null;
    if (!this.opening) this.opening = new Promise(resolve => {
      let request;
      try { request = indexedDB.open('shiny-teeth-recordings', 1); } catch { resolve(null); return; }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('takes')) request.result.createObjectStore('takes', { keyPath: 'id' });
      };
      request.onsuccess = () => { this.db = request.result; resolve(this.db); };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this.opening;
  }
  async put(id, blob) {
    const item = { id, blob, updatedAt: Date.now() };
    this.memory.set(id, item);
    const db = await this.open();
    if (!db) return;
    await new Promise(resolve => {
      try {
        const tx = db.transaction('takes', 'readwrite');
        tx.objectStore('takes').put(item);
        tx.oncomplete = tx.onerror = tx.onabort = resolve;
      } catch { resolve(); }
    });
  }
  async get(id) {
    if (this.memory.has(id)) return this.memory.get(id);
    const db = await this.open();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const req = db.transaction('takes').objectStore('takes').get(id);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  async delete(id) {
    this.memory.delete(id);
    const db = await this.open();
    if (!db) return;
    await new Promise(resolve => {
      try {
        const tx = db.transaction('takes', 'readwrite');
        tx.objectStore('takes').delete(id);
        tx.oncomplete = tx.onerror = tx.onabort = resolve;
      } catch { resolve(); }
    });
  }
}

export class LearningEngine extends EventTarget {
  constructor({ song, phrases, sections, audioFactory, storage, mediaDevices, MediaRecorderClass, recordStore } = {}) {
    super();
    this.song = song; this.phrases = phrases; this.sections = sections;
    this.audio = audioFactory ? audioFactory() : new Audio();
    this.audio.preload = 'metadata';
    this.audio.setAttribute?.('playsinline', '');
    this.audio.preservesPitch = true;
    this.audio.webkitPreservesPitch = true;
    try { this.storage = storage ?? globalThis.localStorage; } catch { this.storage = null; }
    this.mediaDevices = mediaDevices ?? globalThis.navigator?.mediaDevices;
    this.Recorder = MediaRecorderClass ?? globalThis.MediaRecorder;
    this.records = recordStore ?? new RecordingStore();
    this._token = 0; this._cleanups = new Set(); this._source = ''; this._custom = null; this._objectUrls = new Set();
    this._mediaOffset = 0; this._usingSpeech = false;
    this._destroyed = false; this._beatSound = false; this._lastBeat = -1; this._context = null; this._frame = null;
    this._recorder = null; this._recordTimer = null; this._stream = null; this._recordDone = null;
    let progress = {};
    try { progress = sanitizeProgress(JSON.parse(this.storage?.getItem(PROGRESS_KEY) ?? '{}'), phrases); } catch {}
    this.state = {
      status: 'idle', mode: 'song', currentTime: 0, duration: song.duration, rangeStart: 0, rangeEnd: song.duration, rate: 1,
      phraseId: null, error: null, recordSeconds: 0, canRecord: !!(this.mediaDevices?.getUserMedia && this.Recorder),
      trackLabel: 'Original', activeTrackLabel: 'Original', trackAligned: true, progress,
      beatIndex: -1, repetition: 0, totalRepetitions: 1,
      capabilities: { chant: phrases.some(p => p.chantUrl), melody: phrases.some(p => p.melodyUrl), beatAligned: !!song.bpm && Number.isFinite(song.beatOffset) },
    };
    this._onTime = () => this._tick();
    this._onPlaying = () => {
      if (this.state.status === 'loading' || this.state.status === 'paused') this._update({ status: 'playing' });
      this._startFrames();
    };
    this.audio.addEventListener('timeupdate', this._onTime);
    this.audio.addEventListener('playing', this._onPlaying);
  }

  _update(patch = {}) {
    Object.assign(this.state, patch);
    if (!this._destroyed) this.dispatchEvent(new CustomEvent('statechange', { detail: { ...this.state } }));
  }
  _safeWrite(key, value) { try { this.storage?.setItem(key, JSON.stringify(value)); } catch {} }
  getProgress() { return { ...this.state.progress }; }
  setProgress(id, level) {
    if ((id !== '__fullsong__' && !this.phrases.some(p => p.id === id)) || ![0, 1, 2].includes(level)) throw new Error('Choose a valid line and progress level.');
    const progress = { ...this.state.progress, [id]: level };
    this._safeWrite(PROGRESS_KEY, progress); this._update({ progress });
    this.dispatchEvent(new CustomEvent('progresschange', { detail: { ...progress } }));
  }
  resetProgress() {
    this._safeWrite(PROGRESS_KEY, {}); this._safeWrite(LAST_KEY, null); this._update({ progress: {} });
    this.dispatchEvent(new CustomEvent('progresschange', { detail: {} }));
  }
  getLastPractice() {
    try {
      const last = JSON.parse(this.storage?.getItem(LAST_KEY) ?? 'null');
      if (last && [1, 2, 3, 4, 5, 6].includes(last.phaseId) && this.phrases.some(p => p.id === last.phraseId)) return last;
    } catch {}
    return null;
  }
  saveLastPractice(phaseId, phraseId) { this._safeWrite(LAST_KEY, { phaseId: Number(phaseId), phraseId }); }
  _fail(error, fallback = 'Audio could not play. Try again.') {
    if (error?.name === 'AbortError' || this._destroyed) return;
    this.audio.pause(); this._stopFrames();
    this._update({ status: 'error', error: typeof error === 'string' ? error : fallback });
  }
  _assertToken(token) { if (token !== this._token || this._destroyed) throw abortError(); }
  _startFrames() {
    if (!globalThis.requestAnimationFrame || this._frame) return;
    const frame = () => {
      this._frame = null;
      if (this.state.status !== 'playing') return;
      this._tick(); this._frame = requestAnimationFrame(frame);
    };
    this._frame = requestAnimationFrame(frame);
  }
  _stopFrames() { if (this._frame) globalThis.cancelAnimationFrame?.(this._frame); this._frame = null; }
  _tick() {
    if (!['playing', 'paused', 'loading'].includes(this.state.status) || this.state.mode === 'beat') return;
    const currentTime = (this.audio.currentTime || 0) + this._mediaOffset;
    this._boundaryCheck?.();
    const now = performance.now();
    if (this.state.status === 'playing' && this._lastTickAt != null && now - this._lastTickAt < 75) return;
    this._lastTickAt = now;
    let phraseId = this.state.phraseId;
    if (this.state.mode === 'song' && this.state.trackAligned) {
      const section = this.sections.find(s => currentTime >= s.start && currentTime < s.end);
      const occurrence = section?.occurrences?.find(o => currentTime >= o.start && currentTime < o.end);
      if (occurrence) phraseId = occurrence.phraseId;
    }
    let beatIndex = -1;
    if (this.state.capabilities.beatAligned && ['song', 'echo'].includes(this.state.mode) && this.state.trackAligned) {
      beatIndex = Math.floor((currentTime - this.song.beatOffset) * this.song.bpm / 60);
      if (beatIndex >= 0 && beatIndex !== this._lastBeat && this.state.status === 'playing') {
        this._lastBeat = beatIndex;
        if (this._beatSound) this._beep(beatIndex % 4 === 0);
      }
    }
    this._update({ currentTime, phraseId, beatIndex });
  }

  async play(options = {}) {
    this.stop();
    this._lastTickAt = null;
    const token = this._token;
    const mode = options.mode ?? 'song';
    const rate = clamp(options.rate ?? this.state.rate, 0.6, 1.25);
    if (mode === 'chant' && !this.state.capabilities.chant) { this._fail('No rhythm example is available. Try the original song.'); return; }
    if (mode === 'melody' && !this.state.capabilities.melody) { this._fail('No melody example is available. Hum along with the original song.'); return; }
    let segments;
    try { segments = resolveSegments(options, this.song, this.phrases, this.sections); }
    catch (e) { this._fail(e.message); return; }
    this._lastBeat = -1;
    this._update({ status: 'loading', mode, rate, error: null, phraseId: segments[0]?.phraseId ?? null,
      currentTime: segments[0]?.start ?? 0, totalRepetitions: Math.round(clamp(options.repeats ?? 1, 1, 5)), repetition: 1 });
    this._task = (mode === 'beat' ? this._playBeat(options, token) : this._run(segments, options, token)).catch(e => {
      if (token === this._token) this._fail(e);
    });
  }
  async _run(segments, options, token) {
    const mode = options.mode ?? 'song';
    const useCustom = this._custom && mode === 'song' && !options.phraseIds?.length && !options.sectionId && options.start == null && options.end == null;
    this._update({ activeTrackLabel: useCustom ? this._custom.name : ['spoken', 'chant', 'melody'].includes(mode) ? 'Line example' : 'Original', trackAligned: !useCustom });
    for (let repeat = 0; repeat < this.state.totalRepetitions; repeat++) {
      this._assertToken(token); this._update({ repetition: repeat + 1 });
      for (const segment of segments) {
        this._assertToken(token);
        this._update({ phraseId: segment.phraseId });
        if (['spoken', 'chant', 'melody'].includes(mode)) {
          const url = segment[`${mode === 'spoken' ? 'spoken' : mode}Url`];
          try {
            if (!url) throw new Error('missing asset');
            await this._playSegment(url, 0, Infinity, this.state.rate, token);
          } catch (e) {
            this._assertToken(token);
            if (mode === 'spoken') await this._speak(segment.text, this.state.rate, token);
            else throw e;
          }
        } else {
          const clipUrl = segment.audioUrl || segment.sungUrl;
          const offset = !useCustom && clipUrl ? segment.start : 0;
          const start = !useCustom && clipUrl ? 0 : segment.start;
          const end = useCustom ? Infinity : segment.end - offset;
          await this._playSegment(useCustom ? this._custom.url : clipUrl || this.song.audioUrl, start, end, this.state.rate, token, offset);
        }
        this._assertToken(token);
        if (mode === 'echo') { this._update({ phraseId: segment.phraseId }); await this._waitResponse(options, token); }
      }
    }
    this._assertToken(token); this._stopFrames(); this._update({ status: 'idle' });
  }
  _playSegment(src, start, end, rate, token, offset = 0) {
    return new Promise((resolve, reject) => {
      this._assertToken(token);
      this._mediaOffset = offset; this._usingSpeech = false;
      let settled = false; let begun = false;
      const sourceChanged = this._source !== src;
      const updateRange = (metadataAvailable = false) => {
        const mediaDuration = (metadataAvailable || !sourceChanged) && Number.isFinite(this.audio.duration) ? this.audio.duration : this.song.duration;
        const rangeEnd = (Number.isFinite(end) ? end : mediaDuration) + offset;
        this._update({ duration: rangeEnd, rangeStart: start + offset, rangeEnd });
      };
      const cleanup = () => {
        this.audio.removeEventListener('timeupdate', check);
        this.audio.removeEventListener('ended', finish);
        this.audio.removeEventListener('error', error);
        this.audio.removeEventListener('loadedmetadata', metadata);
        if (this._boundaryCheck === check) this._boundaryCheck = null;
        this._cleanups.delete(cancel);
      };
      const finish = () => {
        if (settled) return;
        settled = true; cleanup(); this.audio.pause(); this._stopFrames(); resolve();
      };
      const cancel = () => { if (settled) return; settled = true; cleanup(); reject(abortError()); };
      const error = () => { if (settled) return; settled = true; cleanup(); reject(new Error('audio unavailable')); };
      const check = () => {
        if (token !== this._token) { cancel(); return; }
        if (Number.isFinite(end) && this.audio.currentTime >= end - 0.015) finish();
      };
      const begin = () => {
        if (begun || token !== this._token || settled) return;
        begun = true;
        try { this.audio.currentTime = start; } catch { error(); return; }
        Promise.resolve(this.audio.play()).then(() => {
          if (token !== this._token || settled) return;
          // A new media resource can reset its clock during initialization.
          if (start > 0 && this.audio.currentTime < start - 0.1) this.audio.currentTime = start;
          this._update({ status: 'playing', currentTime: (this.audio.currentTime || 0) + offset }); this._startFrames();
        }).catch(error);
      };
      const metadata = () => {
        if (token !== this._token || settled) return;
        updateRange(true); begin();
      };
      this._cleanups.add(cancel);
      this._boundaryCheck = check;
      this.audio.addEventListener('timeupdate', check);
      this.audio.addEventListener('ended', finish);
      this.audio.addEventListener('error', error);
      this.audio.addEventListener('loadedmetadata', metadata);
      this._update({ status: 'loading' });
      if (sourceChanged) {
        this._source = src; this.audio.src = src; this.audio.load();
      }
      this.audio.playbackRate = rate;
      this.audio.preservesPitch = true;
      this.audio.webkitPreservesPitch = true;
      updateRange(); this._update({ currentTime: start + offset });
      // Zero-based clips can start directly in the tap gesture. Nonzero original
      // seeks wait until their media resource has metadata before playback.
      if (start === 0 || this.audio.readyState >= 1) begin();
    });
  }
  _speak(text, rate, token) {
    const synth = globalThis.speechSynthesis;
    if (!synth || !globalThis.SpeechSynthesisUtterance) throw new Error('speech unavailable');
    return new Promise((resolve, reject) => {
      this._assertToken(token);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US'; utterance.rate = rate * 0.85;
      const voices = synth.getVoices();
      utterance.voice = voices.find(v => v.lang === 'en-US' && /Samantha|Aria|Jenny/i.test(v.name)) ?? voices.find(v => v.lang.startsWith('en')) ?? null;
      let done = false;
      const clean = () => { this._cleanups.delete(cancel); this._usingSpeech = false; };
      const cancel = () => { if (done) return; done = true; clean(); synth.cancel(); reject(abortError()); };
      this._cleanups.add(cancel);
      utterance.onend = () => { if (done) return; done = true; clean(); resolve(); };
      utterance.onerror = () => { if (done) return; done = true; clean(); reject(new Error('speech unavailable')); };
      this._usingSpeech = true; this._mediaOffset = 0;
      if (synth.paused) synth.resume();
      this._update({ status: 'playing', activeTrackLabel: 'Device voice', currentTime: 0, rangeStart: 0, rangeEnd: 0 });
      synth.speak(utterance);
    });
  }
  _waitResponse(options, token) {
    return new Promise((resolve, reject) => {
      this._assertToken(token);
      let timer; let done = false;
      const cleanup = () => { clearTimeout(timer); this._cleanups.delete(cancel); this._continue = null; };
      const finish = () => { if (done) return; done = true; cleanup(); resolve(); };
      const cancel = () => { if (done) return; done = true; cleanup(); reject(abortError()); };
      this._cleanups.add(cancel); this._continue = finish;
      this._update({ status: 'waiting' });
      if (options.manualResponse === false) timer = setTimeout(finish, clamp(options.waitSeconds ?? 5, 2, 30) * 1000);
    });
  }
  continueEcho() { this._continue?.(); }
  pause() {
    if (this.state.status !== 'playing') return;
    if (this.state.mode === 'beat') { this.stop(); return; }
    if (this._usingSpeech) globalThis.speechSynthesis?.pause();
    else this.audio.pause();
    this._stopFrames(); this._update({ status: 'paused' });
  }
  async resume() {
    if (this.state.status !== 'paused') return;
    const token = this._token;
    try {
      if (this._usingSpeech) globalThis.speechSynthesis?.resume();
      else await this.audio.play();
      this._assertToken(token);
      this._update({ status: 'playing' }); this._startFrames();
    } catch (e) { if (token === this._token) this._fail(e); }
  }
  stop() {
    this._token++;
    for (const cancel of [...this._cleanups]) cancel();
    this._cleanups.clear(); this._continue = null;
    this.audio.pause(); globalThis.speechSynthesis?.cancel(); this._stopFrames();
    this._usingSpeech = false;
    if (this._recorder?.state === 'recording') this._recorder.stop();
    this._releaseStream(); clearInterval(this._recordTimer); this._recordTimer = null;
    this._update({ status: 'idle', error: null, beatIndex: -1 });
  }
  setRate(rate) {
    const value = clamp(rate, 0.6, 1.25);
    this.audio.playbackRate = value; this._update({ rate: value });
  }
  seek(seconds) {
    if (!['song', 'echo'].includes(this.state.mode)) return;
    const target = clamp(seconds, this.state.rangeStart ?? 0, this.state.rangeEnd ?? this.song.duration);
    this.audio.currentTime = Math.max(0, target - this._mediaOffset); this._tick();
  }
  setBeatSound(value) { this._beatSound = !!value; if (value) this._ensureContext(); }
  _ensureContext() {
    try {
      const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!this._context && AudioContextClass) this._context = new AudioContextClass();
      if (this._context?.state === 'suspended') this._context.resume().catch(() => {});
    } catch {}
    return this._context;
  }
  _beep(accent = false) {
    const context = this._ensureContext();
    if (!context) return;
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = accent ? 720 : 520;
    gain.gain.setValueAtTime(0.075, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.065);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.08);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  _playBeat(options, token) {
    this._mediaOffset = 0;
    this._ensureContext();
    const duration = clamp((options.end ?? 16) - (options.start ?? 0), 4, 60);
    const began = performance.now();
    this._update({ status: 'playing', currentTime: 0, duration, rangeStart: 0, rangeEnd: duration, beatIndex: 0, activeTrackLabel: 'Steady beat', trackAligned: false });
    this._beep(true);
    return new Promise((resolve, reject) => {
      let beat = 0;
      let timer;
      const tick = () => {
        if (token !== this._token) { cancel(); return; }
        const elapsed = (performance.now() - began) / 1000;
        if (elapsed >= duration) { clearTimeout(timer); this._cleanups.delete(cancel); this._update({ status: 'idle' }); resolve(); return; }
        beat++; this._beep(beat % 4 === 0); this._update({ currentTime: elapsed, beatIndex: beat });
        timer = setTimeout(tick, 60000 / 100 / this.state.rate);
      };
      const cancel = () => { clearTimeout(timer); this._cleanups.delete(cancel); reject(abortError()); };
      this._cleanups.add(cancel);
      timer = setTimeout(tick, 60000 / 100 / this.state.rate);
    });
  }

  async startRecording(phraseId) {
    this.stop();
    const token = this._token;
    if (!this.state.canRecord) { this._fail('Recording is unavailable in this browser. You can still listen and sing along. Try opening this app in your phone browser.'); return; }
    if (phraseId !== '__fullsong__' && !this.phrases.some(p => p.id === phraseId)) { this._fail('Choose a line to record first.'); return; }
    this._update({ status: 'loading', error: null, phraseId, recordSeconds: 0 });
    try {
      const stream = await this.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (token !== this._token) { stream.getTracks().forEach(t => t.stop()); return; }
      this._stream = stream;
      const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
      const mimeType = types.find(type => this.Recorder.isTypeSupported?.(type));
      const recorder = new this.Recorder(stream, mimeType ? { mimeType } : undefined);
      this._recorder = recorder;
      const chunks = []; const started = Date.now(); let recordTimer;
      this._recordDone = new Promise(resolve => {
        recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
        recorder.onstop = async () => {
          clearInterval(recordTimer);
          if (this._recordTimer === recordTimer) this._recordTimer = null;
          stream.getTracks().forEach(t => t.stop());
          if (this._stream === stream) this._stream = null;
          if (this._recorder === recorder) this._recorder = null;
          if (token === this._token && this.state.status === 'recording') {
            this.audio.pause();
            this._update({ status: 'idle', recordSeconds: (Date.now() - started) / 1000 });
          }
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
          if (blob.size) {
            await this.records.put(phraseId, blob);
            if (!this._destroyed) this.dispatchEvent(new CustomEvent('recordingschange', { detail: { phraseId } }));
          }
          resolve();
        };
        recorder.onerror = () => {
          clearInterval(recordTimer);
          stream.getTracks().forEach(t => t.stop());
          if (token === this._token) this._fail('Your recording could not be saved. Try again.');
          resolve();
        };
      });
      recorder.start(250);
      this._mediaOffset = 0;
      this._update({ status: 'recording', mode: 'recording', phraseId, recordSeconds: 0 });
      if (phraseId === '__fullsong__') {
        const src = this._custom?.url ?? this.song.audioUrl;
        if (this._source !== src) { this._source = src; this.audio.src = src; this.audio.load(); }
        this.audio.currentTime = 0; this.audio.playbackRate = this.state.rate;
        const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : this.song.duration;
        this._update({ activeTrackLabel: this._custom?.name ?? 'Original', trackAligned: !this._custom, currentTime: 0, duration, rangeStart: 0, rangeEnd: duration });
        this.audio.play().catch(() => {
          if (token === this._token) this._update({ error: 'The music did not start. Sing solo for this take, then try again.' });
        });
      }
      recordTimer = setInterval(() => {
        if (token !== this._token) return;
        const seconds = (Date.now() - started) / 1000;
        this._update({ recordSeconds: seconds, ...(phraseId === '__fullsong__' ? { currentTime: this.audio.currentTime || 0 } : {}) });
        const fullFinished = phraseId === '__fullsong__' && this.audio.ended;
        if (fullFinished || seconds >= (phraseId === '__fullsong__' ? 180 : 60)) this.stopRecording();
      }, 250);
      this._recordTimer = recordTimer;
    } catch (e) {
      this._releaseStream();
      if (token === this._token) this._fail(e, e.name === 'NotAllowedError' ? 'Microphone access is off. Allow access and try again. You can still listen and sing along.' : 'No microphone is available. You can still sing along.');
    }
  }
  async stopRecording() {
    if (this.state.status === 'recording') {
      this.audio.pause(); this._stopFrames();
      clearInterval(this._recordTimer); this._recordTimer = null;
      this._releaseStream();
      this._update({ status: 'idle' });
    }
    if (this._recorder?.state === 'recording') this._recorder.stop();
    await this._recordDone;
  }
  _releaseStream() { this._stream?.getTracks().forEach(t => t.stop()); this._stream = null; }
  async hasRecording(id) { return !!(await this.records.get(id)); }
  async playRecording(id) {
    this.stop(); const token = this._token;
    const record = await this.records.get(id);
    if (token !== this._token) return;
    if (!record) { this._fail('No recording for this line yet. Record it first.'); return; }
    const url = URL.createObjectURL(record.blob); this._objectUrls.add(url);
    this._update({ mode: 'recording', phraseId: id, error: null, status: 'loading', activeTrackLabel: 'My recording', trackAligned: false });
    this._task = this._playSegment(url, 0, Infinity, 1, token).then(() => {
      if (token === this._token) this._update({ status: 'idle' });
    }).catch(e => { if (token === this._token) this._fail(e); }).finally(() => {
      URL.revokeObjectURL(url); this._objectUrls.delete(url);
    });
  }
  async deleteRecording(id) { await this.records.delete(id); this.dispatchEvent(new CustomEvent('recordingschange', { detail: { phraseId: id } })); }
  async downloadRecording(id) {
    const record = await this.records.get(id);
    if (!record) { this._fail('No recording for this line yet.'); return; }
    const url = URL.createObjectURL(record.blob);
    const a = document.createElement('a'); a.href = url;
    const ext = record.blob.type.includes('mp4') ? 'm4a' : 'webm';
    a.download = `shiny-teeth-${id}.${ext}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async setCustomTrack(file) {
    if (!file || !file.size || file.size > 50 * 1024 * 1024 || (!file.type.startsWith('audio/') && !/\.(mp3|m4a|wav|ogg|aac|webm)$/i.test(file.name))) {
      this._fail('Choose an audio file smaller than 50 MB.'); return;
    }
    this.stop();
    if (this._custom) URL.revokeObjectURL(this._custom.url);
    this._custom = { url: URL.createObjectURL(file), name: file.name };
    this._update({ trackLabel: file.name });
  }
  useOriginalTrack() {
    this.stop();
    if (this._custom) URL.revokeObjectURL(this._custom.url);
    this._custom = null;
    this._update({ trackLabel: 'Original', activeTrackLabel: 'Original', trackAligned: true });
  }
  destroy() {
    this.stop(); this._destroyed = true;
    this.audio.removeEventListener('timeupdate', this._onTime);
    this.audio.removeEventListener('playing', this._onPlaying);
    if (this._custom) URL.revokeObjectURL(this._custom.url);
    for (const url of this._objectUrls) URL.revokeObjectURL(url);
    this._objectUrls.clear(); this._context?.close().catch(() => {});
  }
}
