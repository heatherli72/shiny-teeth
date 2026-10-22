// Mic-only PCM capture. AudioWorklet outputs stay silent: there is no live mic monitoring.
class ShinyTeethPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.finished = false;
    this.firstFrame = null;
    this.lastFrame = null;
    this.chunk = new Float32Array(Math.max(128, Math.round(sampleRate * .2)));
    this.used = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'begin') {
        this.startFrame = data.startFrame;
        this.endFrame = data.endFrame;
        this.active = true;
      } else if (data.type === 'stop') {
        this.endFrame = Math.min(this.endFrame, data.endFrame);
        this.finish();
      }
    };
  }
  flush() {
    if (!this.used) return;
    const samples = this.chunk.slice(0, this.used);
    this.port.postMessage({ type: 'samples', firstFrame: this.chunkFrame, samples }, [samples.buffer]);
    this.used = 0;
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    this.active = false;
    this.flush();
    this.port.postMessage({ type: 'done', lastFrame: this.lastFrame });
  }
  process(inputs, outputs) {
    if (this.finished) return false;
    if (!this.active) return true;
    const channels = inputs[0] || [];
    const frames = channels[0]?.length || outputs[0]?.[0]?.length || 128;
    const begin = Math.max(0, this.startFrame - currentFrame);
    const end = Math.min(frames, this.endFrame - currentFrame);
    // Wait for real microphone input; all subsequent missing input is silent PCM,
    // preserving one continuous context clock rather than shortening the recording.
    if (channels.length || this.firstFrame !== null) {
      for (let index = begin; index < end; index++) {
        const frame = currentFrame + index;
        if (this.firstFrame === null) this.firstFrame = frame;
        if (!this.used) this.chunkFrame = frame;
        let value = 0;
        for (const channel of channels) value += channel[index] || 0;
        this.chunk[this.used++] = channels.length ? value / channels.length : 0;
        this.lastFrame = frame + 1;
        if (this.used === this.chunk.length) this.flush();
      }
    }
    if (currentFrame + frames >= this.endFrame) this.finish();
    return !this.finished;
  }
}
registerProcessor('shiny-teeth-pcm', ShinyTeethPCM);
