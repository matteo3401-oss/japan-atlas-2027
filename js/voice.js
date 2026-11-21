/* Plays the journey's narration, one recorded line at a time.

   A line is { src, length }: `load(src)` (the same loader the films use) resolves
   with its audio. The journey asks two things of this while a line is being
   spoken: is it still going (`active`), and how much of it is left (`remaining`),
   so that it can slow down and let the line finish. */

const KEEP = 16;   // lines held ready at once

export class Narrator {
  constructor(load) {
    this.load = load;
    this.el = new Audio();
    this.el.preload = 'auto';
    this.urls = new Map();           // src → Promise<object URL | null>
    this.line = null;
    this.ready = false;
    this.paused = false;
    this.since = 0;
    this.el.addEventListener('ended', () => { this.line = null; });
    this.el.addEventListener('error', () => { if (this.ready) this.line = null; });
  }

  /** Called from a tap or click: some browsers only let a page speak once it has been touched. */
  prime() {
    if (this.primed || this.line) return;
    this.primed = true;
    const bytes = new Uint8Array(44 + 800).fill(128);
    const view = new DataView(bytes.buffer);
    [[0, 0x52494646], [8, 0x57415645], [12, 0x666d7420], [36, 0x64617461]].forEach(([at, v]) => view.setUint32(at, v));
    view.setUint32(4, 36 + 800, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true); view.setUint32(40, 800, true);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    this.el.src = url;
    this.el.play().then(() => { if (!this.line) this.el.pause(); }).catch(() => {}).finally(() => setTimeout(() => URL.revokeObjectURL(url), 4000));
  }

  /** Fetch a line ahead of time, so it starts the moment it is due. */
  preload(line) {
    if (!this.urls.has(line.src)) {
      this.urls.set(line.src, this.load(line.src).then((blob) => URL.createObjectURL(blob)).catch(() => null));
      if (this.urls.size > KEEP) {
        const [oldest, pending] = this.urls.entries().next().value;
        if (!this.line || this.line.src !== oldest) { this.urls.delete(oldest); pending.then((url) => { if (url) URL.revokeObjectURL(url); }); }
      }
    }
    return this.urls.get(line.src);
  }

  /** Is a line being spoken (or about to be)? A line that never starts is given up on, so nothing can wait on it for ever. */
  get active() {
    if (this.line && !this.paused && performance.now() - this.since > (this.line.length + 6) * 1000) this.stop();
    return !!this.line;
  }

  /** Seconds of the current line still to be spoken. */
  get remaining() {
    if (!this.line) return 0;
    if (!this.ready || !Number.isFinite(this.el.duration)) return this.line.length;
    return Math.max(0, this.el.duration - this.el.currentTime);
  }

  async say(line) {
    this.stop();
    this.line = line;
    this.ready = false;
    this.paused = false;
    this.since = performance.now();
    const url = await this.preload(line);
    if (this.line !== line) return;
    if (!url) { this.line = null; return; }
    this.el.src = url;
    this.ready = true;
    if (!this.paused) this._play();
  }

  _play() {
    const line = this.line;
    this.since = performance.now() - (this.el.currentTime || 0) * 1000;
    // refused because the page has not been touched yet: carry on without this line
    this.el.play().catch((err) => { if (err && err.name === 'NotAllowedError' && this.line === line) this.line = null; });
  }

  pause() { if (this.line) { this.paused = true; this.el.pause(); } }

  resume() { if (this.line && this.paused) { this.paused = false; if (this.ready) this._play(); } }

  stop() { this.el.pause(); this.line = null; this.paused = false; }
}
