import { PerformanceStore, StudioError } from './performance-store.js';
import { buildTimeline, latestPhraseTakes } from './studio-model.js';

const CANCELLED = Symbol('cancelled');
const clamp = (number, low, high) => Math.max(low, Math.min(high, Number.isFinite(Number(number)) ? Number(number) : low));
const messageEvent = (name, detail) => {
  if (typeof CustomEvent === 'function') return new CustomEvent(name, { detail });
  return Object.assign(new Event(name), { detail });
};
const stopNode = node => { try { node?.stop(); } catch {} try { node?.disconnect(); } catch {} };
const disconnect = node => { try { node?.disconnect(); } catch {} };
const stopStream = stream => { for (const track of stream?.getTracks?.() || []) { try { track.stop(); } catch {} } };
const recordingName = (name, createdAt) => String(name || '').trim() || new Date(createdAt || Date.now()).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const audioError = (error, fallback) => {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return 'Allow microphone access, then start recording again.';
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return 'No microphone found. Connect one and try again.';
  if (error?.name === 'NotReadableError') return 'Your microphone is in use. Close other apps using it and try again.';
  return error instanceof StudioError ? error.message : fallback;
};
function wavBlob(channels, sampleRate) {
  const frames = channels[0]?.length || 0, channelCount = channels.length;
  const bytes = frames * channelCount * 2;
  const output = new ArrayBuffer(44 + bytes), view = new DataView(output);
  const text = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes, true);
  let at = 44;
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channelCount; channel++) {
    const value = clamp(channels[channel][frame], -1, 1);
    view.setInt16(at, Math.round(value * (value < 0 ? 32768 : 32767)), true); at += 2;
  }
  return new Blob([output], { type: 'audio/wav' });
}

export class PerformanceStudio extends EventTarget {
  constructor(options = {}) {
    super();
    this.song = options.song || {};
    this.phrases = options.phrases || [];
    this.sections = options.sections || [];
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    this._contextFactory = options.audioContextFactory || (AudioContextClass ? () => new AudioContextClass() : null);
    this._offlineFactory = options.offlineAudioContextFactory || (globalThis.OfflineAudioContext ? (...args) => new OfflineAudioContext(...args) : null);
    this._workletFactory = options.workletNodeFactory || (globalThis.AudioWorkletNode ? (ctx, name) => new AudioWorkletNode(ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }) : null);
    this.mediaDevices = options.mediaDevices === undefined ? globalThis.navigator?.mediaDevices : options.mediaDevices;
    this._fetch = options.fetch || globalThis.fetch?.bind(globalThis);
    this.store = options.store || new PerformanceStore({ indexedDB: options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB });
    this._setInterval = options.setInterval || globalThis.setInterval.bind(globalThis);
    this._clearInterval = options.clearInterval || globalThis.clearInterval.bind(globalThis);
    this._setTimeout = options.setTimeout || globalThis.setTimeout.bind(globalThis);
    this._clearTimeout = options.clearTimeout || globalThis.clearTimeout.bind(globalThis);
    this._countdownSeconds = clamp(options.countdownSeconds ?? 0, 0, 10);
    this._scheduleAhead = clamp(options.scheduleAhead ?? .08, .02, 1);
    this._workletURL = options.workletModuleUrl || new URL('./pcm-recorder-worklet.js', import.meta.url).href;
    this._generation = 0;
    this._destroyed = false;
    this._ctx = null;
    this._operation = null;
    this._capture = null;
    this._playback = null;
    this._ticker = null;
    this._original = null;
    this._originalLoading = null;
    this._instrumental = null;
    this._instrumentalLoading = null;
    this._practiceAudio = new Map();
    this._practiceLoading = new Map();
    this._workletLoading = null;
    this._saving = null;
    this.state = {
      status: 'idle', currentTime: 0, absoluteTime: 0, leadIn: false, duration: Number(this.song.duration) || 0, countdown: 0,
      mode: 'guided', volume: .22, error: null, draft: null, activeTakeId: null,
      phraseId: null, rangeStart: 0, rangeEnd: Number(this.song.duration) || 0, playbackKind: null,
      canRecord: Boolean(this.mediaDevices?.getUserMedia && this._contextFactory && this._workletFactory),
      storagePersistent: Boolean(this.store.persistent),
    };
  }
  _patch(patch) {
    if (this._destroyed) return;
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(messageEvent('statechange', { ...this.state }));
  }
  _valid(operation) { return !this._destroyed && operation === this._operation && !operation.cancelled; }
  _beginOperation(kind) {
    this._cancelOperation();
    const operation = { kind, token: ++this._generation, cancelled: false };
    operation.cancelPromise = new Promise(resolve => { operation.cancelResolve = resolve; });
    this._operation = operation;
    return operation;
  }
  _cancelOperation() {
    if (this._operation) { this._operation.cancelled = true; this._operation.cancelResolve(CANCELLED); }
    this._operation = null;
    this._generation++;
  }
  async _await(promise, operation, timeout = 20000, message = 'Audio setup timed out. Try again.') {
    let timer;
    try {
      return await Promise.race([
        promise, operation.cancelPromise,
        new Promise((_, reject) => { timer = this._setTimeout(() => reject(new StudioError(message)), timeout); }),
      ]);
    } finally { this._clearTimeout(timer); }
  }
  _context() {
    if (!this._contextFactory) throw new StudioError('Recording is not supported here. Try the latest Safari or Chrome.');
    if (!this._ctx) {
      this._ctx = this._contextFactory();
      this._contextChange = () => {
        if (this._ctx.state === 'running' || this._destroyed) return;
        if (this._capture && !this._capture.stopping) {
          this._capture.warning = 'Audio was interrupted. Your recording up to that point is kept. Try a new take.';
          this.stopRecording().catch(() => {});
        } else if (this._playback) this.stopPlayback();
      };
      this._ctx.addEventListener?.('statechange', this._contextChange);
    }
    return this._ctx;
  }
  async _loadOriginal(ctx) {
    if (this._original) return this._original;
    if (!this._originalLoading) this._originalLoading = (async () => {
      if (!this._fetch || !this.song.audioUrl) throw new StudioError('Could not load the song. Reopen this page and try again.');
      const response = await this._fetch(this.song.audioUrl);
      if (this._destroyed) throw new StudioError('This recording page is closed. Audio loading was cancelled.');
      if (!response.ok) throw new StudioError('Could not load the song. Check your connection and try again.');
      let decoded;
      try { const bytes = await response.arrayBuffer();
        if (this._destroyed) throw new StudioError('This recording page is closed. Audio loading was cancelled.');
        decoded = await ctx.decodeAudioData(bytes); }
      catch { throw new StudioError('Could not read the song audio. Try an updated browser.'); }
      if (!this._destroyed) this._original = decoded;
      return decoded;
    })().catch(error => { this._originalLoading = null; throw error; });
    return this._originalLoading;
  }
  async _loadInstrumental(ctx) {
    if (this._instrumental) return this._instrumental;
    if (!this._instrumentalLoading) this._instrumentalLoading = (async () => {
      if (!this._fetch || !this.song.instrumentalUrl) throw new StudioError('Instrumental audio is unavailable. Try With Song instead.');
      let response;
      try { response = await this._fetch(this.song.instrumentalUrl); }
      catch { throw new StudioError('Could not load the instrumental. Check your connection and try again.'); }
      if (this._destroyed) throw new StudioError('This recording page is closed. Audio loading was cancelled.');
      if (!response.ok) throw new StudioError('Could not load the instrumental. Check your connection and try again.');
      let decoded;
      try {
        const bytes = await response.arrayBuffer();
        if (this._destroyed) throw new StudioError('This recording page is closed. Audio loading was cancelled.');
        decoded = await ctx.decodeAudioData(bytes);
      } catch (error) {
        if (error instanceof StudioError) throw error;
        throw new StudioError('Could not read the instrumental audio. Try an updated browser.');
      }
      if (!this._destroyed) this._instrumental = decoded;
      return decoded;
    })().catch(error => { this._instrumentalLoading = null; throw error; });
    return this._instrumentalLoading;
  }
  _loadBacking(ctx, mode) {
    return mode === 'solo' ? Promise.resolve(null) : mode === 'instrumental' ? this._loadInstrumental(ctx) : this._loadOriginal(ctx);
  }
  async _loadPractice(ctx, url) {
    if (this._practiceAudio.has(url)) return this._practiceAudio.get(url);
    if (!this._practiceLoading.has(url)) this._practiceLoading.set(url, (async () => {
      let response;
      try { response = await this._fetch(url); }
      catch { throw new StudioError('Could not load the practice audio. Check your connection and try again.'); }
      if (this._destroyed) throw new StudioError('This recording page is closed. Audio loading was cancelled.');
      if (!response.ok) throw new StudioError('Could not load the practice audio. Check your connection and try again.');
      let decoded;
      try {
        const bytes = await response.arrayBuffer();
        if (this._destroyed) throw new StudioError('This recording page is closed. Audio loading was cancelled.');
        decoded = await ctx.decodeAudioData(bytes);
      } catch (error) {
        if (error instanceof StudioError) throw error;
        throw new StudioError('Could not read the practice audio. Try an updated browser.');
      }
      if (!this._destroyed) this._practiceAudio.set(url, decoded);
      return decoded;
    })().catch(error => { this._practiceLoading.delete(url); throw error; }));
    return this._practiceLoading.get(url);
  }
  async _loadWorklet(ctx) {
    if (!ctx.audioWorklet?.addModule || !this._workletFactory) {
      this._patch({ canRecord: false });
      throw new StudioError('Recording is not supported here. Open this app over HTTPS or localhost in the latest Safari or Chrome.');
    }
    if (!this._workletLoading) this._workletLoading = ctx.audioWorklet.addModule(this._workletURL).catch(() => {
      this._workletLoading = null;
      throw new StudioError('Could not load the recorder. Refresh this page and try again.');
    });
    return this._workletLoading;
  }
  _startTicker() {
    this._stopTicker();
    this._ticker = this._setInterval(() => this._tick(), 50);
  }
  _stopTicker() { if (this._ticker !== null) this._clearInterval(this._ticker); this._ticker = null; }
  _tick() {
    const capture = this._capture;
    if (capture && !capture.stopping && capture.songZero !== undefined) {
      const elapsed = this._ctx.currentTime - capture.songZero;
      const absoluteTime = clamp(capture.rangeStart + elapsed, capture.leadInStart, capture.rangeEnd);
      if (elapsed < 0) this._patch({ status: capture.leadInDuration > 0 || !this._countdownSeconds ? 'recording' : 'countdown', countdown: capture.leadInDuration > 0 || !this._countdownSeconds ? 0 : Math.max(1, Math.ceil(-elapsed)), currentTime: 0, absoluteTime, leadIn: capture.leadInDuration > 0 });
      else {
        this._patch({ status: 'recording', countdown: 0, currentTime: Math.min(capture.duration, elapsed), absoluteTime, leadIn: false });
        // The rendering thread owns the exact final sample. Give its done message
        // a short delivery window before the main-thread watchdog requests a flush.
        if (elapsed >= capture.duration + .3) this.stopRecording().catch(() => {});
      }
    } else if (this._playback) {
      const elapsed = Math.max(0, this._ctx.currentTime - this._playback.songZero) * (this._playback.rate || 1);
      if (elapsed >= this._playback.take.duration) this._finishPlayback();
      else this._patch({ currentTime: elapsed, absoluteTime: (this._playback.take.rangeStart || 0) + elapsed, leadIn: false });
    }
  }
  async start({ mode = 'guided', volume = this.state.volume, phraseId = null, start: rangeStart = 0, end: rangeEnd = this.song.duration, leadInStart = rangeStart, name = '', sectionIds = [] } = {}) {
    if (this._destroyed) throw new StudioError('This recording page is closed. Reopen it to continue.');
    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeStart < 0 || rangeEnd > this.song.duration || rangeEnd <= rangeStart || !Number.isFinite(leadInStart) || leadInStart < 0 || leadInStart > rangeStart) {
      const error = new StudioError('This line has invalid recording times. Choose a line with song timing.');
      this._patch({ status: 'error', error: error.message }); throw error;
    }
    if (!this.state.canRecord) {
      const error = new StudioError('Microphone recording is unavailable. Use HTTPS and the latest Safari or Chrome.');
      this._patch({ status: 'error', error: error.message }); throw error;
    }
    if (this._capture || this._operation?.kind === 'record') return;
    this.stopPlayback();
    const operation = this._beginOperation('record');
    const capture = { operation, phraseId: phraseId || null, rangeStart, rangeEnd, leadInStart, leadInDuration: rangeStart - leadInStart, name: String(name || '').trim(), sectionIds: [...new Set(sectionIds)], duration: rangeEnd - rangeStart, mode: ['solo', 'instrumental'].includes(mode) ? mode : 'guided', volume: clamp(volume, 0, .5), chunks: [], firstFrame: null, stream: null, stopping: false, released: false, done: false };
    this._capture = capture;
    this._patch({ status: 'preparing', mode: capture.mode, volume: capture.volume, currentTime: 0, absoluteTime: leadInStart, leadIn: capture.leadInDuration > 0, duration: capture.duration, countdown: 0, error: null, activeTakeId: null, phraseId: capture.phraseId, rangeStart, rangeEnd, playbackKind: null });
    try {
      // Create and resume directly in the user gesture, before awaiting any loading.
      const ctx = this._context();
      const resume = ctx.resume();
      const permission = this.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, video: false }).then(stream => {
        if (!this._valid(operation)) { stopStream(stream); return null; }
        capture.stream = stream;
        return stream;
      });
      const tasks = [resume, permission, this._loadWorklet(ctx), this._loadBacking(ctx, capture.mode), capture.leadInDuration > 0 ? this._loadOriginal(ctx) : null];
      const prepared = await this._await(Promise.all(tasks), operation, 30000, 'Recording setup timed out. Allow microphone access and try again.');
      if (prepared === CANCELLED || !this._valid(operation)) return;
      capture.playbackZero = ctx.currentTime + this._countdownSeconds + this._scheduleAhead;
      capture.songZero = capture.playbackZero + capture.leadInDuration;
      capture.stopFrame = Math.ceil((capture.songZero + capture.duration) * ctx.sampleRate);
      capture.node = this._workletFactory(ctx, 'shiny-teeth-pcm');
      capture.mic = ctx.createMediaStreamSource(capture.stream);
      capture.mute = ctx.createGain(); capture.mute.gain.value = 0;
      capture.node.port.onmessage = event => this._captureMessage(capture, event.data);
      capture.processorError = () => {
        if (this._capture !== capture) return;
        capture.warning = 'Recording was interrupted. The available audio is kept. Try a new take.';
        this._beginStop(capture, true);
      };
      capture.node.addEventListener?.('processorerror', capture.processorError);
      capture.interrupted = () => {
        if (this._capture !== capture || capture.stopping) return;
        capture.warning = 'Your microphone disconnected or was muted. Your recording up to that point is kept.';
        this.stopRecording().catch(() => {});
      };
      for (const track of capture.stream.getAudioTracks?.() || []) {
        track.addEventListener?.('ended', capture.interrupted);
        track.addEventListener?.('mute', capture.interrupted);
      }
      capture.node.port.postMessage({ type: 'begin', startFrame: Math.ceil((ctx.currentTime + .02) * ctx.sampleRate), endFrame: capture.stopFrame });
      capture.mic.connect(capture.node); capture.node.connect(capture.mute); capture.mute.connect(ctx.destination);
      const lead = prepared[4];
      if (lead) {
        capture.leadGain = ctx.createGain(); capture.leadGain.gain.value = 1;
        capture.leadReference = ctx.createBufferSource(); capture.leadReference.buffer = lead;
        capture.leadReference.connect(capture.leadGain); capture.leadGain.connect(ctx.destination);
        capture.leadReference.start(capture.playbackZero, capture.leadInStart, Math.min(capture.leadInDuration, lead.duration - capture.leadInStart));
      }
      const backing = prepared[3];
      if (backing) {
        capture.referenceGain = ctx.createGain(); capture.referenceGain.gain.value = capture.volume;
        capture.reference = ctx.createBufferSource(); capture.reference.buffer = backing;
        capture.reference.connect(capture.referenceGain); capture.referenceGain.connect(ctx.destination);
        capture.reference.start(capture.songZero, capture.rangeStart, Math.min(capture.duration, backing.duration - capture.rangeStart));
      }
      this._patch({ status: 'countdown', countdown: this._countdownSeconds, currentTime: 0 });
      this._startTicker(); this._tick();
    } catch (error) {
      if (!this._valid(operation)) return;
      this._cancelOperation(); this._releaseCapture(capture); this._capture = null; this._stopTicker();
      const message = audioError(error, 'Could not start recording. Check your microphone and try again.');
      this._patch({ status: 'error', error: message, countdown: 0, leadIn: false });
      throw new StudioError(message);
    }
  }
  _captureMessage(capture, data) {
    if (this._destroyed || this._capture !== capture) return;
    if (data.type === 'samples' && data.samples?.length && Number.isFinite(data.firstFrame)) {
      if (capture.firstFrame === null) capture.firstFrame = data.firstFrame;
      capture.chunks.push({ firstFrame: data.firstFrame, samples: data.samples });
    } else if (data.type === 'done') {
      capture.done = true;
      capture.naturalEnd = Number.isFinite(data.lastFrame) && data.lastFrame >= capture.stopFrame;
      if (!capture.stopping) this._beginStop(capture, true);
      else this._finalizeCapture(capture);
    }
  }
  async stopRecording() {
    if (this._destroyed) return;
    const capture = this._capture;
    if (!capture) {
      if (this._operation?.kind === 'replay') this.stopPlayback();
      else if (this.state.status === 'preparing') { this._cancelOperation(); this._patch({ status: this.state.draft ? 'draft' : 'idle', countdown: 0, leadIn: false }); }
      return;
    }
    if (capture.stopping) return capture.stopPromise;
    if (capture.songZero === undefined || this._ctx.currentTime <= capture.songZero) {
      this._cancelOperation(); this._releaseCapture(capture); this._capture = null; this._stopTicker();
      capture.chunks.length = 0;
      this._patch({ status: this.state.draft ? 'draft' : 'idle', currentTime: 0, absoluteTime: capture.rangeStart, leadIn: false, countdown: 0 }); return;
    }
    return this._beginStop(capture, false);
  }
  _beginStop(capture, alreadyDone) {
    if (capture.stopping) return capture.stopPromise;
    capture.stopping = true;
    capture.stopTime = capture.naturalEnd ? capture.songZero + capture.duration : Math.min(this._ctx.currentTime, capture.songZero + capture.duration);
    capture.stopFrame = Math.min(capture.stopFrame, Math.floor(capture.stopTime * this._ctx.sampleRate));
    capture.stopPromise = new Promise((resolve, reject) => { capture.resolveStop = resolve; capture.rejectStop = reject; });
    this._stopTicker(); stopNode(capture.reference); disconnect(capture.referenceGain); stopNode(capture.leadReference); disconnect(capture.leadGain);
    this._releaseTracks(capture);
    this._patch({ status: 'stopping', countdown: 0, currentTime: Math.max(0, capture.stopTime - capture.songZero), absoluteTime: capture.rangeStart + Math.max(0, capture.stopTime - capture.songZero), leadIn: false });
    if (alreadyDone || capture.done) this._finalizeCapture(capture);
    else {
      capture.flushTimer = this._setTimeout(() => {
        capture.warning = 'Finishing the recording timed out. The available audio is kept. Listen before saving.';
        this._finalizeCapture(capture);
      }, 1500);
      try { capture.node.port.postMessage({ type: 'stop', endFrame: capture.stopFrame }); }
      catch { this._finalizeCapture(capture); }
    }
    // Internal auto-stop is always handled; callers still receive the original rejection.
    capture.stopPromise.catch(() => {});
    return capture.stopPromise;
  }
  _releaseTracks(capture) {
    if (capture.released) return;
    capture.released = true;
    for (const track of capture.stream?.getAudioTracks?.() || []) {
      track.removeEventListener?.('ended', capture.interrupted); track.removeEventListener?.('mute', capture.interrupted);
    }
    stopStream(capture.stream);
  }
  _releaseCapture(capture) {
    this._releaseTracks(capture);
    this._clearTimeout(capture.flushTimer);
    stopNode(capture.reference); disconnect(capture.referenceGain); stopNode(capture.leadReference); disconnect(capture.leadGain); disconnect(capture.mic); disconnect(capture.node); disconnect(capture.mute);
    capture.node?.removeEventListener?.('processorerror', capture.processorError);
    if (capture.node?.port) { capture.node.port.onmessage = null; capture.node.port.close?.(); }
  }
  _finalizeCapture(capture) {
    if (capture.finalized || this._capture !== capture || this._destroyed) return;
    capture.finalized = true;
    this._releaseCapture(capture); this._capture = null; this._cancelOperation();
    try {
      if (capture.firstFrame === null || !capture.chunks.length) throw new StudioError('No microphone audio was received. Check microphone access and record again.');
      const first = capture.firstFrame;
      const lastChunk = capture.chunks.at(-1);
      const last = Math.min(capture.stopFrame, lastChunk.firstFrame + lastChunk.samples.length);
      if (last <= first || last <= Math.ceil(capture.songZero * this._ctx.sampleRate)) throw new StudioError('The recording ended before your line began. Try again and sing after the lead-in.');
      const samples = new Float32Array(last - first);
      let previous = first;
      for (const chunk of capture.chunks) {
        if (chunk.firstFrame !== previous) capture.warning ||= 'Your recording has a brief interruption. Listen before saving.';
        const offset = chunk.firstFrame - first;
        if (offset >= samples.length) break;
        samples.set(chunk.samples.subarray(0, Math.max(0, Math.min(chunk.samples.length, samples.length - offset))), offset);
        previous = chunk.firstFrame + chunk.samples.length;
      }
      const duration = Math.max(0, Math.min(capture.duration, capture.stopTime - capture.songZero, last / this._ctx.sampleRate - capture.songZero));
      const createdAt = new Date().toISOString();
      const draft = {
        id: globalThis.crypto?.randomUUID?.() || `take-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        blob: wavBlob([samples], this._ctx.sampleRate), mode: capture.mode, duration,
        phraseId: capture.phraseId, rangeStart: capture.rangeStart, rangeEnd: capture.rangeEnd,
        createdAt, name: recordingName(capture.name, createdAt), source: capture.phraseId ? 'learn' : 'sing', sectionIds: capture.sectionIds, volume: capture.volume,
        voiceOffset: first / this._ctx.sampleRate - capture.songZero,
        complete: !capture.warning && duration >= capture.duration - 1 / this._ctx.sampleRate,
      };
      capture.chunks.length = 0;
      this._patch({ status: 'draft', draft, currentTime: duration, absoluteTime: capture.rangeStart + duration, leadIn: false, error: capture.warning || null });
      capture.resolveStop?.();
    } catch (error) {
      capture.chunks.length = 0;
      const message = audioError(error, 'Could not process the recording. Record again.');
      this._patch({ status: 'error', error: message, leadIn: false }); capture.rejectStop?.(new StudioError(message));
    }
  }
  async saveDraft({ name } = {}) {
    if (this._saving) return this._saving;
    const draft = this.state.draft;
    if (!draft) throw new StudioError('No recording draft to save.');
    const savedTake = { ...draft, id: draft.phraseId ? `line-${draft.phraseId}` : draft.id, name: recordingName(name === undefined ? draft.name : name, draft.createdAt), source: draft.phraseId ? 'learn' : 'sing', sectionIds: draft.sectionIds || [] };
    this._saving = (async () => {
      try {
        await this.store.put(savedTake);
        if (!this._destroyed) {
          const previewingDraft = this._playback?.take.id === draft.id;
          if (previewingDraft) this._playback.take = savedTake;
          const activeTakeId = this._capture || this._playback && !previewingDraft ? this.state.activeTakeId : savedTake.id;
          const retainedDraft = this.state.draft?.id === draft.id ? null : this.state.draft;
          this._patch({ status: this._playback ? 'playing' : this._capture ? this.state.status : retainedDraft ? 'draft' : 'idle', draft: retainedDraft, activeTakeId, storagePersistent: true, error: null });
          this.dispatchEvent(new Event('takeschange'));
        }
        return savedTake;
      } catch (error) {
        const message = audioError(error, 'Could not save your recording. Check device storage. Your draft is kept; try again.');
        this._patch({ error: message, status: this._playback ? 'playing' : this._capture ? this.state.status : this.state.draft ? 'draft' : 'error', storagePersistent: Boolean(this.store.persistent) });
        throw new StudioError(message);
      } finally { this._saving = null; }
    })();
    return this._saving;
  }
  async renameTake(id, name) {
    try {
      const take = await this.store.get(id);
      if (!take) throw new StudioError('This recording is unavailable.');
      const renamed = { ...take, name: recordingName(name, take.createdAt) };
      await this.store.put(renamed);
      if (this._playback?.take.id === id) this._playback.take = renamed;
      this._patch({ error: null });
      if (!this._destroyed) this.dispatchEvent(new Event('takeschange'));
      return renamed;
    } catch (error) {
      const message = audioError(error, 'Could not rename the recording. Try again.');
      this._patch({ error: message }); throw new StudioError(message);
    }
  }
  discardDraft() {
    if (this._saving) return;
    this.stopPlayback();
    this._patch({ status: 'idle', draft: null, currentTime: 0, absoluteTime: 0, leadIn: false, activeTakeId: null, error: null });
  }
  async listTakes() {
    try {
      const takes = await this.store.list();
      this._patch({ storagePersistent: Boolean(this.store.persistent) });
      return takes;
    } catch (error) {
      const message = audioError(error, 'Could not read saved recordings. Check browser storage access and try again.');
      this._patch({ error: message, storagePersistent: false }); throw new StudioError(message);
    }
  }
  async deleteTake(id) {
    try {
      await this.store.delete(id);
      if (this.state.activeTakeId === id) { this.stopPlayback(); this._patch({ activeTakeId: null }); }
      if (!this._destroyed) this.dispatchEvent(new Event('takeschange'));
    } catch (error) {
      const message = audioError(error, 'Could not delete the recording. Try again.'); this._patch({ error: message }); throw new StudioError(message);
    }
  }
  async discardLine(phraseId) {
    if (typeof phraseId !== 'string' || !phraseId.trim()) throw new StudioError('Choose a saved line to discard.');
    if (this._destroyed) throw new StudioError('This recording page is closed. Reopen it to continue.');
    if (this._capture || this._operation?.kind === 'record') throw new StudioError('Stop recording before discarding a saved line.');
    if (this._saving) throw new StudioError('Wait for your recording to finish saving, then discard the line.');
    this.stopPlayback();
    try {
      const deletedIds = await this.store.deletePhrase(phraseId);
      this._patch({ error: null, activeTakeId: deletedIds.includes(this.state.activeTakeId) ? null : this.state.activeTakeId });
      if (!this._destroyed) this.dispatchEvent(new Event('takeschange'));
      return deletedIds;
    } catch (error) {
      const message = audioError(error, 'Could not discard this line. Your saved recordings are kept. Try again.');
      this._patch({ error: message }); throw new StudioError(message);
    }
  }
  async _take(takeOrId) {
    const take = typeof takeOrId === 'string' ? await this.store.get(takeOrId) : takeOrId || this.state.draft;
    if (!take?.blob || !Number.isFinite(take.duration) || take.duration <= 0) throw new StudioError('No recording to play. Make a recording first.');
    return take;
  }
  async _decodeVoice(ctx, take) {
    try { return await ctx.decodeAudioData(await take.blob.arrayBuffer()); }
    catch { throw new StudioError('Could not read the recording audio. Record again or try an updated browser.'); }
  }
  _scheduleSource(ctx, buffer, when, offset, duration, volume, nodes) {
    if (duration <= 0 || offset >= buffer.duration) return null;
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    nodes.push(source, gain);
    source.buffer = buffer; gain.gain.value = volume;
    source.connect(gain); gain.connect(ctx.destination);
    source.start(when, offset, Math.min(duration, buffer.duration - offset));
    return { source, gain };
  }
  _scheduleMix(ctx, take, voice, music, songZero, withMusic = true) {
    const nodes = [];
    try {
      const voiceOffset = Number(take.voiceOffset) || 0;
      const delay = Math.max(0, voiceOffset), offset = Math.max(0, -voiceOffset);
      this._scheduleSource(ctx, voice, songZero + delay, offset, take.duration - delay, 1, nodes);
      if (withMusic && music) {
        const originalOffset = take.rangeStart || 0;
        this._scheduleSource(ctx, music, songZero, originalOffset, Math.min(take.duration, music.duration - originalOffset), clamp(take.volume ?? this.state.volume, 0, .5), nodes);
      }
      return nodes;
    } catch (error) { for (const node of nodes) stopNode(node); throw error; }
  }
  async replay(takeOrId, { withMusic = true } = {}) {
    if (this._capture || this._operation?.kind === 'record') throw new StudioError('Stop recording before listening.');
    this.stopPlayback();
    const operation = this._beginOperation('replay');
    this._patch({ status: 'preparing', currentTime: 0, leadIn: false, error: null, playbackKind: 'take' });
    try {
      const ctx = this._context(); const resume = ctx.resume();
      const prepared = await this._await(Promise.all([resume, this._take(takeOrId)]), operation);
      if (prepared === CANCELLED || !this._valid(operation)) return;
      const [, take] = prepared;
      const results = await this._await(Promise.all([Promise.resolve(), this._decodeVoice(ctx, take), withMusic ? this._loadBacking(ctx, take.mode) : null]), operation);
      if (results === CANCELLED || !this._valid(operation)) return;
      const [, voice, music] = results, songZero = ctx.currentTime + this._scheduleAhead;
      const nodes = this._scheduleMix(ctx, take, voice, music, songZero, withMusic);
      this._playback = { operation, take, songZero, nodes };
      this._patch({ status: 'playing', currentTime: 0, absoluteTime: take.rangeStart || 0, leadIn: false, duration: take.duration, phraseId: take.phraseId || null, rangeStart: take.rangeStart || 0, rangeEnd: take.rangeEnd ?? this.song.duration, playbackKind: 'take', activeTakeId: take.id === this.state.draft?.id ? null : take.id || null, volume: clamp(take.volume ?? this.state.volume, 0, .5) });
      this._startTicker();
    } catch (error) {
      if (!this._valid(operation)) return;
      this._cancelOperation(); this._stopTicker();
      const message = audioError(error, 'Could not play the recording. Try again.');
      this._patch({ status: this.state.draft ? 'draft' : 'error', error: message }); throw new StudioError(message);
    }
  }
  async playReference({ mode = 'guided', start = 0, end = this.song.duration, rate = 1 } = {}) {
    if (this._capture || this._operation?.kind === 'record') throw new StudioError('Stop recording before listening.');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > this.song.duration || end <= start) throw new StudioError('This audio range is unavailable. Choose another line.');
    this.stopPlayback();
    const operation = this._beginOperation('replay');
    const playbackRate = clamp(rate, .5, 2), backingMode = mode === 'instrumental' ? 'instrumental' : 'guided';
    const practiceURL = this.song.practiceAudio?.[backingMode]?.[String(playbackRate)];
    this._patch({ status: 'preparing', currentTime: 0, absoluteTime: start, leadIn: false, duration: end - start, rangeStart: start, rangeEnd: end, mode: backingMode, countdown: 0, activeTakeId: null, playbackKind: 'reference', error: null });
    const nodes = [];
    try {
      const ctx = this._context(); const resume = ctx.resume();
      const prepared = await this._await(Promise.all([resume, practiceURL ? this._loadPractice(ctx, practiceURL) : this._loadBacking(ctx, backingMode)]), operation);
      if (prepared === CANCELLED || !this._valid(operation)) return;
      const songZero = ctx.currentTime + this._scheduleAhead;
      const mediaScale = practiceURL ? playbackRate : 1;
      const scheduled = this._scheduleSource(ctx, prepared[1], songZero, start / mediaScale, (end - start) / mediaScale, 1, nodes);
      if (!scheduled) throw new StudioError('This audio range is unavailable. Choose another line.');
      scheduled.source.playbackRate.value = practiceURL ? 1 : playbackRate;
      this._playback = { operation, take: { duration: end - start, rangeStart: start }, songZero, nodes, rate: playbackRate };
      this._patch({ status: 'playing' });
      this._startTicker();
    } catch (error) {
      for (const node of nodes) stopNode(node);
      if (!this._valid(operation)) return;
      this._cancelOperation(); this._stopTicker();
      const message = audioError(error, 'Could not play the example. Try again.');
      this._patch({ status: this.state.draft ? 'draft' : 'error', error: message }); throw new StudioError(message);
    }
  }
  _finishPlayback() {
    const playback = this._playback;
    if (!playback) return;
    this._playback = null;
    for (const node of playback.nodes) stopNode(node);
    this._stopTicker(); this._cancelOperation();
    this._patch({ status: this.state.draft ? 'draft' : 'idle', currentTime: playback.take.duration, absoluteTime: (playback.take.rangeStart || 0) + playback.take.duration, leadIn: false });
  }
  stopPlayback() {
    const preparingReplay = this._operation?.kind === 'replay';
    if (this._playback) {
      const playback = this._playback; this._playback = null;
      for (const node of playback.nodes) stopNode(node);
      this._stopTicker();
    } else if (!preparingReplay) return;
    this._cancelOperation();
    this._patch({ status: this.state.draft ? 'draft' : 'idle', currentTime: 0, absoluteTime: this.state.rangeStart || 0, leadIn: false, countdown: 0 });
  }
  setVolume(value) {
    const volume = clamp(value, 0, .5);
    if (this._capture && !this._capture.stopping) {
      this._capture.volume = volume;
      if (this._capture.referenceGain) this._capture.referenceGain.gain.setValueAtTime(volume, this._ctx.currentTime);
    }
    this._patch({ volume });
  }
  async _prepareAssembly(ctx, operation = null) {
    const [takes, music] = await Promise.all([this.store.list(), this._loadOriginal(ctx)]);
    if (this._destroyed || operation && !this._valid(operation)) return CANCELLED;
    const timeline = buildTimeline(this.phrases, this.sections);
    const latest = latestPhraseTakes(takes);
    const usedIds = new Set(timeline.filter(line => line.end > 0 && line.start < this.song.duration).map(line => line.phraseId));
    const selected = [...latest.values()].filter(take => usedIds.has(take.phraseId));
    const decoded = await Promise.all(selected.map(async take => [take.phraseId, { take, voice: await this._decodeVoice(ctx, take) }]));
    if (this._destroyed || operation && !this._valid(operation)) return CANCELLED;
    const byPhrase = new Map(decoded);
    const placements = [];
    for (const occurrence of timeline) {
      const recording = byPhrase.get(occurrence.phraseId);
      if (!recording) continue;
      const { take, voice } = recording;
      const voiceOffset = Number(take.voiceOffset) || 0;
      const delay = Math.max(0, voiceOffset);
      const beforeZero = Math.max(0, -(occurrence.start + delay));
      const start = Math.max(0, occurrence.start + delay);
      const offset = Math.max(0, -voiceOffset) + beforeZero;
      const duration = Math.min(occurrence.end - start, take.duration - delay - beforeZero, voice.duration - offset, this.song.duration - start);
      if (duration <= 0) continue;
      placements.push({ start, offset, duration, voice, mode: take.mode || 'guided', volume: clamp(take.volume ?? .22, 0, .5) });
    }
    const instrumental = placements.some(line => line.mode === 'instrumental') ? await this._loadInstrumental(ctx) : null;
    if (this._destroyed || operation && !this._valid(operation)) return CANCELLED;
    return { music, instrumental, placements };
  }
  _scheduleAssembly(ctx, assembly, songZero) {
    const nodes = [];
    try {
      const original = this._scheduleSource(ctx, assembly.music, songZero, 0, Math.min(this.song.duration, assembly.music.duration), 1, nodes);
      const instrumental = assembly.instrumental && this._scheduleSource(ctx, assembly.instrumental, songZero, 0, Math.min(this.song.duration, assembly.instrumental.duration), 0, nodes);
      if (original) {
        // Sweep all boundaries rather than restoring after each independent phrase:
        // an overlapping recorded line must keep the original quiet until it ends.
        const boundaries = [...new Set([0, ...assembly.placements.flatMap(line => [line.start, line.start + line.duration])])].sort((a, b) => a - b);
        let previous = null, previousInstrumental = null;
        for (const time of boundaries) {
          const active = assembly.placements.filter(line => line.start <= time && time < line.start + line.duration);
          const instrumentalLines = active.filter(line => line.mode === 'instrumental');
          const volume = active.some(line => ['instrumental', 'solo'].includes(line.mode)) ? 0 : Math.min(1, ...active.map(line => line.volume));
          if (volume !== previous) original.gain.gain.setValueAtTime(volume, songZero + time);
          previous = volume;
          const instrumentalVolume = instrumentalLines.length ? Math.min(...instrumentalLines.map(line => line.volume)) : 0;
          if (instrumental && instrumentalVolume !== previousInstrumental) instrumental.gain.gain.setValueAtTime(instrumentalVolume, songZero + time);
          previousInstrumental = instrumentalVolume;
        }
      }
      for (const line of assembly.placements) this._scheduleSource(ctx, line.voice, songZero + line.start, line.offset, line.duration, 1, nodes);
      return nodes;
    } catch (error) { for (const node of nodes) stopNode(node); throw error; }
  }
  async replayAssembly() {
    if (this._capture || this._operation?.kind === 'record') throw new StudioError('Stop recording before playing My Song.');
    this.stopPlayback();
    const operation = this._beginOperation('replay');
    this._patch({ status: 'preparing', currentTime: 0, absoluteTime: 0, leadIn: false, duration: this.song.duration, phraseId: null, rangeStart: 0, rangeEnd: this.song.duration, activeTakeId: '__assembly__', playbackKind: 'assembly', error: null });
    try {
      const ctx = this._context(), resume = ctx.resume();
      const results = await this._await(Promise.all([resume, this._prepareAssembly(ctx, operation)]), operation, 30000, 'My Song setup timed out. Try again.');
      if (results === CANCELLED || results[1] === CANCELLED || !this._valid(operation)) return;
      const songZero = ctx.currentTime + this._scheduleAhead;
      const nodes = this._scheduleAssembly(ctx, results[1], songZero);
      this._playback = { operation, take: { duration: this.song.duration }, songZero, nodes };
      this._patch({ status: 'playing', currentTime: 0, activeTakeId: '__assembly__', playbackKind: 'assembly' });
      this._startTicker();
    } catch (error) {
      if (!this._valid(operation)) return;
      this._cancelOperation(); this._stopTicker();
      const message = audioError(error, 'Could not play My Song. Check your saved lines and try again.');
      this._patch({ status: this.state.draft ? 'draft' : 'error', error: message }); throw new StudioError(message);
    }
  }
  async exportAssembly() {
    if (this._capture || this._operation?.kind === 'record') throw new StudioError('Stop recording before downloading My Song.');
    try {
      if (!this._offlineFactory) throw new StudioError('Audio downloads are not supported here. Try the latest Safari or Chrome.');
      const ctx = this._context();
      const assembly = await this._prepareAssembly(ctx);
      if (assembly === CANCELLED || this._destroyed) throw new StudioError('This recording page is closed. The download was cancelled.');
      const channels = Math.max(assembly.music.numberOfChannels, assembly.instrumental?.numberOfChannels || 1, ...assembly.placements.map(line => line.voice.numberOfChannels));
      const offline = this._offlineFactory(channels, Math.ceil(this.song.duration * ctx.sampleRate), ctx.sampleRate);
      this._scheduleAssembly(offline, assembly, 0);
      const mixed = await offline.startRendering();
      if (this._destroyed) throw new StudioError('This recording page is closed. The download was cancelled.');
      return wavBlob(Array.from({ length: mixed.numberOfChannels }, (_, channel) => mixed.getChannelData(channel)), mixed.sampleRate);
    } catch (error) {
      const message = audioError(error, 'Could not download My Song. Free some device storage and try again.'); this._patch({ error: message }); throw new StudioError(message);
    }
  }
  async exportMix(takeOrId) {
    if (this._capture || this._operation?.kind === 'record') throw new StudioError('Stop recording before downloading.');
    try {
      if (!this._offlineFactory) throw new StudioError('Audio downloads are not supported here. Try the latest Safari or Chrome.');
      const take = await this._take(takeOrId), ctx = this._context();
      const [voice, music] = await Promise.all([this._decodeVoice(ctx, take), this._loadBacking(ctx, take.mode)]);
      if (this._destroyed) throw new StudioError('This recording page is closed. The download was cancelled.');
      const channels = Math.max(voice.numberOfChannels, music?.numberOfChannels || 1);
      const offline = this._offlineFactory(channels, Math.ceil(take.duration * ctx.sampleRate), ctx.sampleRate);
      this._scheduleMix(offline, take, voice, music, 0, true);
      const mixed = await offline.startRendering();
      if (this._destroyed) throw new StudioError('This recording page is closed. The download was cancelled.');
      return wavBlob(Array.from({ length: mixed.numberOfChannels }, (_, channel) => mixed.getChannelData(channel)), mixed.sampleRate);
    } catch (error) {
      const message = audioError(error, 'Could not download the mix. Free some device storage and try again.'); this._patch({ error: message }); throw new StudioError(message);
    }
  }
  destroy() {
    if (this._destroyed) return;
    this.stopPlayback(); this._cancelOperation(); this._stopTicker();
    if (this._capture) { this._releaseCapture(this._capture); this._capture.chunks.length = 0; this._capture.resolveStop?.(); this._capture = null; }
    this._destroyed = true;
    this._ctx?.removeEventListener?.('statechange', this._contextChange);
    try { this._ctx?.close()?.catch?.(() => {}); } catch {}
    this.store.close?.(); this._original = null; this._instrumental = null; this._practiceAudio.clear(); this._practiceLoading.clear();
  }
}
