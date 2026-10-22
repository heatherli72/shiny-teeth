// Rolling lyric context uses the original song clock. It holds real lyric lines
// through silence and never inserts an instrumental/status phrase into the track.
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const phraseKey = line => String(line.id || line.phraseId || '');
const overlaps = (line, start, end) => line.end > start && line.start < end;
const prefixKey = value => String(value || 'lyric').replace(/[^A-Za-z0-9_-]/g, '-') || 'lyric';

/**
 * time / targetStart / targetEnd are absolute original-song seconds.
 * phraseId restricts Learn highlighting to the selected occurrence; omit it for
 * a Sing section or the full assembled song. idle centers the selected target.
 */
export function lyricWindowState(timeline = [], { time = 0, targetStart, targetEnd, phraseId, idle = false } = {}) {
  const seen = new Set();
  const source = timeline.filter(line => line && typeof line.text === 'string' && line.text.trim() && !line.isInstrumental && Number.isFinite(line.start) && Number.isFinite(line.end) && line.end > line.start)
    .map((line, index) => {
      const base = String(line.key || `${phraseKey(line) || 'line'}:${line.start}:${line.end}`);
      const key = seen.has(base) ? `${base}:${index}` : base;
      seen.add(key);
      return { ...line, key, id: phraseKey(line), phraseId: phraseKey(line) };
    }).sort((a, b) => a.start - b.start || Number(Boolean(a.isBackingVocal)) - Number(Boolean(b.isBackingVocal)) || a.end - b.end);
  const firstMatching = source.find(line => phraseKey(line) === phraseId);
  const start = Number.isFinite(targetStart) ? targetStart : firstMatching?.start ?? source[0]?.start ?? 0;
  const end = Number.isFinite(targetEnd) && targetEnd > start ? targetEnd : firstMatching?.end ?? source.at(-1)?.end ?? start;
  const clock = Number.isFinite(time) ? time : start;
  // Main vocals provide predictable song context. A backing phrase is included
  // only when Learn explicitly selects that timed occurrence.
  let rows = source.filter(line => !line.isBackingVocal || phraseId && phraseKey(line) === phraseId && overlaps(line, start, end));
  if (!rows.length) rows = source;
  rows = rows.map(line => ({ ...line, target: overlaps(line, start, end) && (!phraseId || phraseKey(line) === phraseId) }));
  let targets = rows.map((line, index) => line.target ? index : -1).filter(index => index >= 0);
  if (!targets.length && rows.length) {
    const candidates = rows.map((line, index) => ({ line, index })).filter(({ line }) => !phraseId || phraseKey(line) === phraseId);
    const closest = (candidates.length ? candidates : rows.map((line, index) => ({ line, index })))
      .reduce((best, candidate) => Math.abs(candidate.line.start - start) < Math.abs(best.line.start - start) ? candidate : best);
    rows[closest.index].target = true;
    targets = [closest.index];
  }
  const leadIn = !idle && clock < start;
  const afterTarget = !idle && clock >= end;
  let focusIndex = targets[0] ?? -1;
  if (!idle && leadIn) {
    const audible = rows.map((line, index) => ({ line, index })).filter(({ line }) => !line.isBackingVocal && line.start <= clock);
    focusIndex = audible.at(-1)?.index ?? focusIndex;
  } else if (afterTarget) focusIndex = targets.at(-1) ?? -1;
  else if (!idle) focusIndex = targets.filter(index => rows[index].start <= clock).at(-1) ?? focusIndex;
  const current = rows[focusIndex] || null;
  const inTarget = Boolean(!idle && !leadIn && !afterTarget && current?.target);
  const singing = Boolean(inTarget && clock >= current.start && clock < current.end);
  return {
    rows, focusIndex, previous: rows[focusIndex - 1] || null, current, next: rows[focusIndex + 1] || null,
    leadIn, inTarget, singing, idle: Boolean(idle), afterTarget, time: clock,
    targetStart: start, targetEnd: end, phraseId: phraseId || null,
    activeKey: current?.key || null, singingKey: singing ? current.key : null,
    targetKey: rows[targets[0]]?.key || null,
  };
}

function rowClasses(line, index, state) {
  return ['lyric-roll-row', line.target && 'is-target', index === state.focusIndex ? 'is-current' : index === state.focusIndex - 1 ? 'is-previous' : index === state.focusIndex + 1 ? 'is-next' : 'is-distant'].filter(Boolean).join(' ');
}
const isInteractive = (state, index, interactive) => Boolean(interactive && index === state.focusIndex && !state.leadIn);

/**
 * Inject renderWords(text, {busy}) for tappable words; the safe default is text.
 * The focused mounted row owns `${prefix}-lyrics`; all other row IDs stay local.
 * Root classes: is-lead-in / is-idle / is-in-target / is-after-target.
 */
function renderTrack(state, { renderWords, prefix = 'lyric', interactive = true } = {}) {
  const id = prefixKey(prefix);
  const content = state.rows.map((line, index) => {
    const focus = index === state.focusIndex;
    const enabled = isInteractive(state, index, interactive);
    const words = renderWords ? renderWords(line.text, { busy: !enabled }) : esc(line.text);
    return `<div id="${id}-${focus ? 'lyrics' : `row-${index}`}" class="${rowClasses(line, index, state)}" data-line-key="${esc(line.key)}" data-focus="${focus}" data-target="${line.target}" data-phrase-id="${esc(phraseKey(line))}" data-start="${line.start}" data-end="${line.end}" data-lyric-text="${esc(line.text)}"${focus ? '' : ' aria-hidden="true"'}${enabled ? '' : ' inert'}>${words}</div>`;
  }).join('');
  return `<div class="lyric-roll-track" style="--lyric-focus:${Math.max(0, state.focusIndex)}">${content}</div>`;
}

export function renderLyricWindow(state, options = {}) {
  const id = prefixKey(options.prefix);
  const classes = ['lyric-roll', state.leadIn && 'is-lead-in', state.idle && 'is-idle', state.inTarget && 'is-in-target', state.afterTarget && 'is-after-target'].filter(Boolean).join(' ');
  return `<div class="${classes}" data-window-prefix="${id}" data-focus-key="${esc(state.activeKey || '')}" aria-live="off">${renderTrack(state, options)}</div>`;
}

const mounted = new WeakMap();

/**
 * Retains the mounted track and rows on ticks. Returns the focused row, whose
 * .lyric-word children can receive a KTV sweep when state.inTarget is true.
 * CSS owns track transition and row styling; this function owns pixel translate.
 */
export function updateLyricWindow(node, state, options = {}) {
  if (!node) return null;
  let roll = node.matches?.('.lyric-roll') ? node : node.querySelector('.lyric-roll');
  let track = roll?.querySelector('.lyric-roll-track');
  let elements = track ? [...track.querySelectorAll('.lyric-roll-row')] : [];
  const previous = roll && mounted.get(roll);
  const changed = elements.length !== state.rows.length || elements.some((element, index) => element.dataset.lineKey !== state.rows[index].key || element.dataset.lyricText !== state.rows[index].text);
  if (!track || changed || previous && previous.renderWords !== options.renderWords) {
    if (roll === node) {
      node.innerHTML = renderTrack(state, { ...options, prefix: options.prefix || roll.dataset.windowPrefix });
    } else {
      node.innerHTML = renderLyricWindow(state, options);
      roll = node.querySelector('.lyric-roll');
    }
    track = roll?.querySelector('.lyric-roll-track');
    elements = track ? [...track.querySelectorAll('.lyric-roll-row')] : [];
  }
  if (!roll || !track) return null;
  const prefix = prefixKey(options.prefix || roll.dataset.windowPrefix || 'lyric');
  roll.dataset.focusKey = state.activeKey || '';
  for (const [name, enabled] of [['is-lead-in', state.leadIn], ['is-idle', state.idle], ['is-in-target', state.inTarget], ['is-after-target', state.afterTarget]]) roll.classList?.toggle(name, Boolean(enabled));
  elements.forEach((element, index) => {
    const focus = index === state.focusIndex, enabled = isInteractive(state, index, options.interactive !== false);
    const line = state.rows[index];
    element.id = `${prefix}-${focus ? 'lyrics' : `row-${index}`}`;
    element.dataset.focus = String(focus); element.dataset.target = String(line.target);
    for (const [name, value] of [['is-current', focus], ['is-previous', index === state.focusIndex - 1], ['is-next', index === state.focusIndex + 1], ['is-distant', Math.abs(index - state.focusIndex) > 1], ['is-target', line.target]]) element.classList.toggle(name, Boolean(value));
    if (focus) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', 'true');
    if (enabled) element.removeAttribute('inert'); else element.setAttribute('inert', '');
    for (const button of element.querySelectorAll('.lyric-word')) {
      button.disabled = !enabled;
      button.tabIndex = enabled ? 0 : -1;
    }
  });
  const focused = elements[state.focusIndex] || null;
  if (focused && roll.clientHeight > 0) {
    const offset = (roll.clientHeight - focused.offsetHeight) / 2 - focused.offsetTop;
    const transform = `translate3d(0, ${Math.round(offset * 100) / 100}px, 0)`;
    if (track.style.transform !== transform) track.style.transform = transform;
  }
  track.style.setProperty('--lyric-focus', String(Math.max(0, state.focusIndex)));
  mounted.set(roll, { renderWords: options.renderWords });
  return focused;
}
