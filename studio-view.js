import { formatTime, isCapturing, subtitleAt, latestPhraseTakes } from './studio-model.js';
import { renderScene, tokenizeLyric, WORDS } from './learning-content.js';
import { lyricWindowState, renderLyricWindow } from './lyric-window.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const disabled = value => value ? ' disabled' : '';
const paths = {
  tooth: '<path d="M7 3c-5 1-4 7-2 12 1 4 2 6 4 4l2-5q1-2 2 0l2 5c2 2 3 0 4-4 2-5 3-11-2-12-2-1-3 1-5 1S9 2 7 3Z"/><path d="M8 9h.01M16 9h.01M9 12q3 3 6 0"/>',
  book: '<path d="M3 5q4-2 9 1 5-3 9-1v15q-4-2-9 1-5-3-9-1Z"/><path d="M12 6v15M6 9h3M6 13h3M15 9h3M15 13h3"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  music: '<path d="M9 18V5l12-3v13M9 9l12-3"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="15" rx="3" ry="3"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  left: '<path d="m14 5-7 7 7 7"/>', right: '<path d="m10 5 7 7-7 7"/>', down: '<path d="m5 9 7 7 7-7"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="m9 14 2 2 4-4"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  speech: '<path d="M20 13a3 3 0 0 1-3 3H9l-6 5V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3Z"/><path d="M7 8h9M7 12h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01"/>',
  singer: '<circle cx="9" cy="11" r="7"/><circle cx="6.5" cy="9" r=".65" fill="currentColor" stroke="none"/><circle cx="11.5" cy="9" r=".65" fill="currentColor" stroke="none"/><ellipse cx="9" cy="14" rx="1.6" ry="2"/><path d="M18 9q3 2 0 4M20 6q6 5 0 10"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  instruments: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M7.5 13v7M12 13v7M16.5 13v7"/><rect x="6.2" y="5" width="2.6" height="8" fill="currentColor" stroke="none"/><rect x="10.7" y="5" width="2.6" height="8" fill="currentColor" stroke="none"/><rect x="15.2" y="5" width="2.6" height="8" fill="currentColor" stroke="none"/>',
  headphones: '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
  sparkle: '<path d="m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6Z"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2.8 2.8 0 0 0-4-4L5 15Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>', check: '<path d="m5 12 5 5L20 7"/>',
};
function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.music}</svg>`;
}
function button(action, text, { className = 'button button-secondary', glyph, attrs = '', busy = false } = {}) {
  return `<button type="button" class="${className}" data-action="${action}"${attrs}${disabled(busy)}>${glyph ? icon(glyph) : ''}<span>${text}</span></button>`;
}
function dateLabel(createdAt) {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? 'This recording' : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}
function sectionLabel(id = '') {
  const match = /^(verse|chorus)(\d+)$/i.exec(id);
  if (match) return `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}`;
  return { intro: 'Intro', bridge: 'Bridge', instrumental: 'Music', outro: 'Outro' }[id] || 'Lyrics';
}
const capturing = ui => isCapturing(ui.perf.status) && !ui.perf.playbackKind && (ui.perf.status !== 'preparing' || Boolean(ui.recordingPhraseId) || ui.tab === 'sing' && !['take', 'review'].includes(ui.sheet) && !ui.draftOpen);
const modeName = mode => mode === 'instrumental' ? 'Instrumental' : mode === 'solo' ? 'Voice only' : 'With Song';
const takeName = take => take.name?.trim() || dateLabel(take.createdAt);
function captureStatus(perf) {
  if (perf.leadIn) return 'Listen in…';
  return { idle: '', preparing: 'Preparing audio…', countdown: 'Listen in…', recording: 'Recording', stopping: 'Finishing…', draft: 'Ready to review', playing: 'Playing', error: 'Try again when ready' }[perf.status] || '';
}
function phraseCaptureId(ui) {
  if (ui.perf.playbackKind) return null;
  return ui.recordingPhraseId || (['countdown', 'recording', 'stopping'].includes(ui.perf.status) ? ui.perf.phraseId : null);
}
export function renderLyricWords(text, { busy = false } = {}) {
  return tokenizeLyric(text).map(token => token.isWord ? `<button type="button" class="lyric-word" data-action="word" data-word="${esc(token.key)}" data-word-index="${token.wordIndex}" aria-label="Learn the word ${esc(token.text)}" aria-haspopup="dialog"${disabled(busy)}><span class="word-face">${esc(token.text)}</span></button>` : esc(token.text)).join('');
}
function scene(phrase, id) {
  return `<div id="${id}" class="lyric-scene" aria-hidden="true">${renderScene(phrase || 'happy')}</div>`;
}
function backingOptions(ui, scope) {
  const value = scope === 'line' ? ui.phraseRecordMode : ui.selectedMode;
  const selected = value === 'instrumental' || value === 'solo' ? 'instrumental' : 'guided';
  const busy = capturing(ui) || ui.saving || ui.exporting;
  return `<div class="record-backing" role="group" aria-label="${scope === 'line' ? 'Line' : 'Sing'} recording backing"><span class="record-backing-caption">Record with</span><div class="record-backing-options">${[['guided', 'With Song', 'singer', 'Singer'], ['instrumental', 'Instrumental', 'instruments', 'Band']].map(([mode, label, glyph, shortLabel]) => `<button type="button" class="backing-icon" data-action="mode" data-mode="${mode}" data-scope="${scope}" aria-label="${label}" title="${label}" aria-pressed="${selected === mode}"${disabled(busy)}>${icon(glyph)}<span class="backing-icon-label" aria-hidden="true">${shortLabel}</span></button>`).join('')}</div></div>`;
}
function recordButton(ui, line = false) {
  const perf = ui.perf;
  const recording = capturing(ui) && (!line || phraseCaptureId(ui) === ui.phraseId);
  if (recording && perf.status === 'recording') return button('stop-record', 'Stop', { className: 'button button-record', glyph: 'stop' });
  if (recording && ['preparing', 'countdown'].includes(perf.status)) return button('cancel-record', 'Cancel', { className: 'button button-secondary', glyph: 'stop' });
  if (recording && perf.status === 'stopping') return button('stop-record', 'Finishing…', { busy: true });
  if (!line && ['playing', 'preparing'].includes(perf.status) && perf.playbackKind && perf.playbackKind !== 'reference') return button('stop-preview', 'Stop', { className: 'button button-record', glyph: 'stop' });
  const busy = capturing(ui) || ui.saving || ui.exporting;
  if (line) {
    const draft = perf.draft?.phraseId === ui.phraseId ? perf.draft : null;
    const saved = latestPhraseTakes(ui.takes).get(ui.phraseId);
    if ((draft || saved) && ui.forceRecordPhraseId !== ui.phraseId) return button('review-line', 'Review', { className: 'button button-yellow', glyph: 'headphones', attrs: ` data-id="${esc((draft || saved).id)}" aria-haspopup="dialog"`, busy });
  }
  return button(line ? 'record-line' : 'record', 'Record', { className: 'button button-record', glyph: 'mic', attrs: line ? ` data-id="${esc(ui.phraseId)}"` : '', busy: busy || perf.canRecord === false || !line && ui.selectedSections.length === 0 });
}
function deletionConfirmation(ui, take) {
  if (!take || ui.deleteId !== take.id) return '';
  const busy = Boolean(ui.saving || ui.exporting || capturing(ui));
  return `<div class="delete-confirm" role="group" aria-label="Delete recording"><p>Delete this recording from this browser?</p><div class="confirmation-actions">${button('confirm-delete', 'Delete', { className: 'button button-record', attrs: ` data-id="${esc(take.id)}"`, busy })}${button('cancel-delete', 'Keep', { attrs: ` data-id="${esc(take.id)}"`, busy })}</div></div>`;
}
function practicePanel(phrases, ui, timeline) {
  const phrase = phrases.find(item => item.id === ui.phraseId) || phrases[0] || {};
  const index = Math.max(0, phrases.findIndex(item => item.id === phrase.id));
  const saved = latestPhraseTakes(ui.takes).get(phrase.id);
  const listening = ['loading', 'playing'].includes(ui.listenStatus);
  const speaking = listening && ui.listenMode === 'spoken';
  const singing = listening && ui.listenMode === 'song';
  const busy = Boolean(capturing(ui) || ui.saving || ui.exporting);
  const recording = capturing(ui) && phraseCaptureId(ui) === phrase.id;
  const replaying = Boolean(ui.perf.status === 'playing' && saved && ui.perf.activeTakeId === saved.id);
  const lineActive = (ui.perf.status === 'playing' || capturing(ui)) && (ui.perf.phraseId === phrase.id || ui.referencePhraseId === phrase.id);
  const absolute = Number.isFinite(ui.perf.absoluteTime) ? ui.perf.absoluteTime : (ui.perf.rangeStart || 0) + (ui.perf.currentTime || 0);
  const lyricWindow = lyricWindowState(timeline, { time: lineActive ? absolute : phrase.start, targetStart: phrase.start, targetEnd: phrase.end, phraseId: phrase.id, idle: !lineActive });
  const status = recording ? (ui.perf.leadIn ? 'Listen in…' : { preparing: 'Preparing microphone…', countdown: 'Listen in…', recording: 'Your turn', stopping: 'Finishing…' }[ui.perf.status]) : ui.listenStatus === 'loading' ? 'Loading…' : speaking ? 'Listen, then try' : singing ? 'Sing along' : replaying ? 'Your recording' : '';
  return `<section class="practice-panel workspace-panel" aria-label="Learn a line">
    <div class="workspace-toolbar">${button('open-sheet', `Line ${index + 1} / ${phrases.length}`, { className: 'picker-button', glyph: 'book', attrs: ' data-sheet="lines" aria-haspopup="dialog"', busy })}<label class="rate-control" for="line-rate"><span class="sr-only">Example speed</span><select id="line-rate"${disabled(busy)}>${[[.7, '0.7×'], [.85, '0.85×'], [1, '1×']].map(([rate, label]) => `<option value="${rate}"${Number(ui.rate) === rate ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div>
    <article class="lyric-card phrase-card${listening ? ' is-listening' : ''}${recording ? ' is-recording' : ''}${ui.perf.leadIn ? ' is-lead-in' : ''}">${scene(lyricWindow.current || phrase, 'phrase-scene')}
      ${saved ? `<span class="saved-indicator is-saved" role="img" aria-label="Saved">${icon('check')}</span>` : ''}
      <div class="phrase-content"><span id="phrase-record-countdown" hidden></span><div id="phrase-window" class="lyric-window-host">${renderLyricWindow(lyricWindow, { renderWords: renderLyricWords, prefix: 'phrase', interactive: !busy })}</div></div>
      <div class="lyric-card-bottom"><p id="phrase-record-status" class="phrase-status" role="status" aria-live="polite">${esc(status)}</p><p id="phrase-record-time" class="phrase-record-time"${recording || replaying ? '' : ' hidden'}>${formatTime(ui.perf.currentTime)} / ${formatTime(ui.perf.duration)}</p></div>
    </article>
    <div class="line-actions">${button(speaking ? 'stop-listen' : 'speak', speaking ? 'Stop' : 'Read', { glyph: speaking ? 'stop' : 'speech', busy })}${button(singing ? (ui.perf.playbackKind === 'reference' ? 'stop-preview' : 'stop-listen') : 'sing-line', singing ? 'Stop' : 'Play', { className: 'button button-yellow', glyph: singing ? 'stop' : 'music', busy: busy || !phrase.sungUrl })}</div>
    <div class="recording-controls">${backingOptions(ui, 'line')}<div class="phrase-navigation">${button('previous', 'Prev', { className: 'button button-secondary icon-button navigation-button', glyph: 'left', attrs: ' aria-label="Prev"', busy: busy || index === 0 })}${recordButton(ui, true)}${button('next', 'Next', { className: 'button button-secondary icon-button navigation-button next-button', glyph: 'right', attrs: ' aria-label="Next"', busy: busy || index === phrases.length - 1 })}</div></div>
  </section>`;
}
function selectableSections(sections) {
  return sections.filter(section => (section.occurrences || []).some(item => !item.isBackingVocal && item.songAvailable !== false && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start));
}
function sectionSummary(sections, ui) {
  const choices = selectableSections(sections);
  const ids = choices.filter(section => ui.selectedSections.includes(section.id)).map(section => section.id);
  if (!ids.length) return 'Choose sections';
  if (ids.length === choices.length) return 'All sections';
  return ids.length <= 2 ? ids.map(sectionLabel).join(' + ') : `${sectionLabel(ids[0])} + ${ids.length - 1} more`;
}
function performancePanel(song, timeline, sections, ui) {
  const perf = ui.perf;
  const absoluteTime = Number.isFinite(perf.absoluteTime) ? perf.absoluteTime : perf.currentTime || 0;
  const selected = timeline.find(line => line.sectionId === (ui.activeSectionId || ui.selectedSections[0]));
  const subtitle = perf.status === 'idle' && selected ? { ...selected, nextText: '', isInstrumental: false } : subtitleAt(timeline, absoluteTime);
  const activeSection = sections.find(section => section.id === (ui.activeSectionId || ui.selectedSections[0]));
  const sectionTimes = (activeSection?.occurrences || []).filter(item => item.songAvailable !== false && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
  const sectionDuration = sectionTimes.length ? Math.max(...sectionTimes.map(item => item.end)) - Math.min(...sectionTimes.map(item => item.start)) : 0;
  const duration = capturing(ui) || ['playing', 'preparing'].includes(perf.status) && perf.playbackKind ? Number(perf.duration) || sectionDuration || song.duration || 0 : sectionDuration;
  const wholeReplay = ui.tab === 'sing' && ui.sheet !== 'take' && ui.sheet !== 'recordings' && perf.status === 'playing' && perf.activeTakeId && perf.activeTakeId !== '__assembly__' && !ui.takes.find(take => take.id === perf.activeTakeId)?.phraseId;
  const busy = capturing(ui) || ui.saving || ui.exporting;
  const selectedIds = selectableSections(sections).filter(section => ui.selectedSections.includes(section.id)).map(section => section.id);
  const activeId = selectedIds.includes(ui.activeSectionId) ? ui.activeSectionId : selectedIds[0];
  const activeIndex = Math.max(0, selectedIds.indexOf(activeId)) + 1;
  const activeLabel = selectedIds.length > 1 ? `${activeIndex}/${selectedIds.length}` : '';
  const reference = ['playing', 'preparing'].includes(perf.status) && perf.playbackKind === 'reference';
  const active = perf.status === 'playing' || capturing(ui);
  const sectionStart = sectionTimes.length ? Math.min(...sectionTimes.map(item => item.start)) : 0;
  const sectionEnd = sectionTimes.length ? Math.max(...sectionTimes.map(item => item.end)) : song.duration;
  const lyricWindow = lyricWindowState(timeline, { time: absoluteTime, targetStart: active ? ui.referenceRange?.targetStart ?? perf.rangeStart ?? sectionStart : sectionStart, targetEnd: active ? ui.referenceRange?.targetEnd ?? perf.rangeEnd ?? sectionEnd : sectionEnd, idle: !active });
  return `<section class="performance-panel workspace-panel" aria-label="Sing selected sections"${ui.tab !== 'sing' ? ' hidden' : ''}>
    <div class="workspace-toolbar">${button('open-sheet', sectionSummary(sections, ui), { className: 'picker-button section-picker', glyph: 'book', attrs: ' data-sheet="sections" aria-haspopup="dialog"', busy })}</div>
    <article class="lyric-card performance-card${perf.status === 'recording' ? ' is-recording' : ''}${perf.leadIn ? ' is-lead-in' : ''}" data-status="${esc(perf.status)}">${scene(lyricWindow.current || subtitle, 'live-scene')}
      <div class="card-topline"><span id="live-status" role="status" aria-live="polite">${esc(captureStatus(perf))}</span>${icon(perf.status === 'recording' ? 'mic' : 'music')}</div>
      <div class="performance-content"><span id="live-countdown" hidden></span><div id="live-window" class="lyric-window-host">${renderLyricWindow(lyricWindow, { renderWords: renderLyricWords, prefix: 'live', interactive: !busy })}</div></div>
      <p id="live-next" hidden></p>
      <div class="song-timeline"><progress id="live-progress" max="${duration}" value="${Math.min(perf.currentTime || 0, duration)}" aria-label="Song progress"></progress><span id="live-time"${wholeReplay ? ' hidden' : ''}>${formatTime(perf.currentTime)} / ${formatTime(duration)}</span>${wholeReplay ? `<span id="take-play-time">${formatTime(perf.currentTime)} / ${formatTime(duration)}</span>` : ''}</div>
    </article>
    ${backingOptions(ui, 'sing')}<div class="record-control"><span id="active-section-label" class="active-section-label"${selectedIds.length > 1 ? ` aria-label="Section ${activeIndex} of ${selectedIds.length}"` : ' hidden'}>${activeLabel}</span><div class="sing-actions">${button(reference ? 'stop-preview' : 'play-section', reference ? 'Stop' : 'Play', { className: 'button button-yellow', glyph: reference ? 'stop' : 'music', busy: reference ? false : busy || selectedIds.length === 0 })}${recordButton(ui)}</div></div>
  </section>`;
}
function librarySources(ui) {
  return `<div class="library-sources segment-control" data-selected="${ui.librarySource}" role="group" aria-label="Recording source">${[['learn', 'From Learn', 'book'], ['sing', 'From Sing', 'mic']].map(([source, label, glyph]) => `<button type="button" class="mode-option" data-action="library-source" data-source="${source}" aria-pressed="${ui.librarySource === source}"${disabled(capturing(ui) || ui.saving || ui.exporting)}>${icon(glyph)}<span>${label}</span></button>`).join('')}</div>`;
}
function takeRows(takes, ui) {
  return takes.map(take => `<button type="button" class="take-open" data-action="open-take" data-id="${esc(take.id)}" aria-haspopup="dialog"${disabled(capturing(ui) || ui.saving || ui.exporting)}><span class="take-row-symbol">${icon('music')}</span><span class="take-row-copy"><strong>${esc(takeName(take))}</strong><small>${esc(modeName(take.mode))} · ${formatTime(take.duration)}${take.complete ? '' : ' · Partial'}</small></span>${icon('right')}</button>`).join('');
}
function learnLineRows(phrases, ui) {
  const latest = latestPhraseTakes(ui.takes);
  const busy = Boolean(ui.saving || ui.exporting || capturing(ui));
  return `<div class="learn-line-list line-library-scroll" role="list" aria-label="Your Learn recordings">${phrases.map((phrase, index) => {
    const take = latest.get(phrase.id);
    const playing = Boolean(take && ui.perf.status === 'playing' && ui.perf.activeTakeId === take.id);
    const action = playing ? 'stop-preview' : take ? 'replay-line' : 'phrase';
    return `<div class="learn-line-row${take ? ' is-saved' : ''}${playing ? ' is-playing' : ''}" role="listitem" data-phrase-id="${esc(phrase.id)}"><button type="button" class="learn-line-main" data-action="${action}" data-id="${esc(take ? take.id : phrase.id)}" aria-label="${playing ? 'Stop' : take ? 'Play' : 'Practice'} ${esc(phrase.text)}" aria-describedby="line-status-${esc(phrase.id)}"${disabled(playing ? false : busy)}><span class="line-row-symbol">${icon(take ? 'check' : 'circle')}</span><span class="line-row-copy"><strong>${esc(phrase.text)}</strong></span>${playing ? `<span class="line-row-time" id="take-play-time">${formatTime(ui.perf.currentTime)} / ${formatTime(ui.perf.duration)}</span>` : ''}<span class="line-row-action">${icon(playing ? 'stop' : take ? 'play' : 'book')}</span></button><span id="line-status-${esc(phrase.id)}" class="sr-only">${take ? 'Saved' : 'Not recorded'}</span>${take ? button('phrase', 'Practice', { className: 'icon-button line-practice', glyph: 'book', attrs: ` data-id="${esc(phrase.id)}" aria-label="Practice ${esc(phrase.text)}" title="Practice line ${index + 1}"`, busy }) : ''}</div>`;
  }).join('')}</div>`;
}
function assemblyPanel(song, phrases, ui) {
  const savedCount = phrases.filter(phrase => latestPhraseTakes(ui.takes).has(phrase.id)).length;
  const wholeTakes = ui.takes.filter(take => !take.phraseId);
  const playing = ui.perf.status === 'playing' && ui.perf.activeTakeId === '__assembly__';
  const busy = Boolean(ui.saving || ui.exporting || capturing(ui));
  const playingLine = ui.perf.status === 'playing' ? ui.takes.find(take => take.id === ui.perf.activeTakeId && take.phraseId) : null;
  const karaoke = playing || Boolean(playingLine);
  const karaokePhrase = playingLine ? phrases.find(phrase => phrase.id === playingLine.phraseId) : phrases[0];
  const learn = `${learnLineRows(phrases, ui)}${karaoke ? `<article class="assembly-now-playing">${scene('happy', 'assembly-scene')}<p id="assembly-lyrics" class="assembly-lyrics" lang="en">${renderLyricWords(karaokePhrase?.text || '')}</p></article>` : ''}<div class="assembly-bottom"><div class="assembly-playback"${playing ? '' : ' hidden'}><span id="assembly-play-time">${formatTime(playing ? ui.perf.currentTime : 0)} / ${formatTime(song.duration)}</span></div><div class="assembly-actions">${button(playing ? 'stop-preview' : 'play-assembly', playing ? 'Stop' : 'Play All', { className: 'button button-yellow', glyph: playing ? 'stop' : 'play', busy: playing ? false : busy })}${button('export-assembly', ui.exporting ? 'Preparing…' : 'Download', { glyph: 'download', busy })}</div></div>`;
  const sing = wholeTakes.length ? `<div class="recent-takes">${takeRows(wholeTakes.slice(0, 3), ui)}</div><div class="library-links">${button('open-sheet', `All recordings (${wholeTakes.length})`, { className: 'list-link', glyph: 'folder', attrs: ' data-sheet="recordings" aria-haspopup="dialog"', busy })}</div>` : `<div class="library-empty">${icon('mic')}<p>No recordings yet</p></div>`;
  return `<section class="takes-panel workspace-panel" aria-label="My Song"><div class="workspace-toolbar"><h1>My Song</h1><span class="saved-count">${ui.librarySource === 'sing' ? `${wholeTakes.length} recording${wholeTakes.length === 1 ? '' : 's'}` : `${savedCount}/${phrases.length} lines`}</span></div>${librarySources(ui)}${ui.librarySource === 'sing' ? sing : learn}</section>`;
}
function lineChoices(phrases, sections, ui) {
  const latest = latestPhraseTakes(ui.takes);
  const busy = Boolean(ui.saving || ui.exporting || capturing(ui));
  const choice = candidate => `<button type="button" class="lyric-choice${candidate.id === ui.phraseId ? ' is-selected' : ''}" data-action="phrase" data-id="${esc(candidate.id)}" aria-pressed="${candidate.id === ui.phraseId}"${disabled(busy)}><span>${esc(candidate.text)}</span><span class="phrase-saved-badge${latest.has(candidate.id) ? ' is-saved' : ''}">${latest.has(candidate.id) ? 'Saved' : 'Not saved'}</span></button>`;
  return sections.map(section => {
    const candidates = phrases.filter(candidate => candidate.sectionId === section.id);
    return candidates.length ? `<div class="lyric-group"><h3>${sectionLabel(section.id)}</h3>${candidates.map(choice).join('')}</div>` : '';
  }).join('') + phrases.filter(phrase => !sections.some(section => section.id === phrase.sectionId)).map(choice).join('');
}
function coverageSheet(phrases, sections, ui) {
  const latest = latestPhraseTakes(ui.takes);
  const byId = new Map(phrases.map(phrase => [phrase.id, phrase]));
  const occurrences = sections.flatMap(section => (section.occurrences || []).map((occurrence, index) => ({ ...occurrence, key: `${section.id}-${index}`, phrase: byId.get(occurrence.phraseId) }))).filter(item => item.phrase);
  const savedCount = phrases.filter(phrase => latest.has(phrase.id)).length;
  const busy = Boolean(ui.saving || ui.exporting || capturing(ui));
  return `<p class="sheet-caption">${savedCount}/${phrases.length} lines saved. The newest recording is used each time a line repeats.</p><div class="saved-lines">${phrases.filter(phrase => latest.has(phrase.id)).map(phrase => {
    const take = latest.get(phrase.id);
    return `<article class="saved-line-item"><p>${esc(phrase.text)}</p><div class="saved-line-tools">${button('phrase', 'Learn', { className: 'text-button', attrs: ` data-id="${esc(phrase.id)}"`, busy })}${button('delete-take', 'Delete', { className: 'text-button', glyph: 'trash', attrs: ` data-id="${esc(take.id)}" aria-label="Delete recording of ${esc(phrase.text)}"`, busy })}</div>${deletionConfirmation(ui, take)}</article>`;
  }).join('')}</div><h3 class="sheet-subtitle">Song order</h3><ol class="assembly-list">${occurrences.map(item => {
    const timed = item.songAvailable !== false && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start;
    const recorded = timed && latest.has(item.phraseId);
    return `<li data-occurrence="${esc(item.key)}" data-phrase-id="${esc(item.phraseId)}"><time>${timed ? formatTime(item.start) : 'Backing'}</time><div><p>${esc(item.phrase.text)}</p>${!timed ? '<small>Untimed backing vocals keep the original.</small>' : ''}</div><span class="source-badge${recorded ? ' is-saved' : ''}">${recorded ? 'My voice' : 'Original'}</span></li>`;
  }).join('')}</ol>`;
}
function recordingsSheet(ui) {
  const takes = ui.takes.filter(take => !take.phraseId);
  return takes.length ? `<div class="takes-list">${takeRows(takes, ui)}</div>` : '<p class="empty-state">No recordings yet. Open Sing to record a section.</p>';
}
function instructionsSheet(ui) {
  const items = [
    ['speech', 'Tap a word', 'See its sound and meaning. Tap Pronounce to hear it.'],
    ['music', 'Listen, then sing', 'Play always uses the original song. Small icons choose recording backing. Follow the musical lead-in and highlighted words.'],
    ['mic', 'Record and review', 'Choose Record with, then Record. Review lets you Play, Save, Record Again or Discard.'],
    ['folder', 'Keep your songs', 'From Learn joins your lines; missing lines use the original. From Sing keeps your recordings. Download a copy to keep it.'],
  ];
  return `<div class="instruction-list">${items.map(([glyph, title, text]) => `<article class="instruction-item"><span class="instruction-symbol">${icon(glyph)}</span><div><h3>${title}</h3><p>${text}</p></div></article>`).join('')}</div><p class="storage-note">Saved in this browser. Clearing browser data removes recordings.${ui.perf.storagePersistent === false ? ' Temporary storage may also be cleared automatically.' : ''}</p>`;
}
function sectionsSheet(sections, ui) {
  const choices = selectableSections(sections);
  return `<p class="sheet-caption">Choose one or more. Each section becomes its own recording.</p><div class="section-choices">${choices.map(section => {
    const times = (section.occurrences || []).filter(item => item.songAvailable !== false && Number.isFinite(item.start) && Number.isFinite(item.end));
    const start = Math.min(...times.map(item => item.start));
    const end = Math.max(...times.map(item => item.end));
    return `<label class="section-choice"><input type="checkbox" data-action="section-toggle" data-id="${esc(section.id)}"${ui.selectedSections.includes(section.id) ? ' checked' : ''}${disabled(capturing(ui) || ui.saving || ui.exporting)}><span><strong>${sectionLabel(section.id)}</strong><small>${formatTime(start)} - ${formatTime(end)}</small></span>${icon('music')}</label>`;
  }).join('')}</div>`;
}
function wordSheet(ui) {
  const key = typeof ui.word === 'string' ? ui.word : ui.word?.key || '';
  const word = WORDS[key] || {};
  return `<div class="word-card"><span class="word-card-symbol">${icon('speech')}${icon('sparkle')}</span><h3 lang="en">${esc(key)}</h3><p class="word-ipa">${esc(word.ipa || '')}</p><p class="word-meaning" lang="zh-CN">${esc(word.zh || word.meaning || '')}</p>${button('pronounce-word', 'Pronounce', { className: 'button button-yellow', glyph: 'speech', attrs: ` data-word="${esc(key)}"` })}</div>`;
}
function sheet(title, content, { draft = false, playing = false, footer = '' } = {}) {
  const titleId = draft ? 'draft-title' : 'sheet-title';
  return `<div class="sheet-backdrop"><section class="sheet-panel${draft ? ' draft-panel' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1"><div class="sheet-heading"><h2 id="${titleId}">${title}</h2>${button('close-sheet', 'Close', { className: 'icon-button sheet-close', glyph: 'close', attrs: ' aria-label="Close"' })}</div>${playing ? `<div class="sheet-playback">${button('stop-preview', 'Stop playback', { className: 'text-button', glyph: 'stop' })}</div>` : ''}<div class="sheet-scroll">${content}</div>${footer ? `<div class="sheet-footer">${footer}</div>` : ''}</section></div>`;
}
function reviewSheet(ui, phrases, feedback = '', forceDraft = false) {
  const draft = ui.perf.draft;
  const take = !forceDraft && ui.reviewTakeId ? (draft?.id === ui.reviewTakeId ? draft : ui.takes.find(item => item.id === ui.reviewTakeId)) : draft;
  if (!take) return sheet('Review', `${feedback}<p class="empty-state">Choose a recording to review.</p>`);
  const isDraft = take.id === draft?.id;
  const phrase = phrases.find(item => item.id === take.phraseId);
  const line = Boolean(take.phraseId);
  const playing = ui.perf.status === 'playing' && (isDraft ? !ui.perf.activeTakeId : ui.perf.activeTakeId === take.id);
  const preparing = ui.perf.status === 'preparing' && !capturing(ui);
  const busy = Boolean(ui.saving || ui.exporting || capturing(ui));
  const previewAction = preparing ? 'cancel-record' : playing ? 'stop-preview' : isDraft ? 'preview' : 'replay-take';
  const nameField = !line ? `<div class="take-name-field"><label for="take-name">Recording name</label><div><input id="take-name" type="text" maxlength="64" value="${esc(ui.renameValue ?? takeName(take))}" autocomplete="off"${disabled(busy)}>${!isDraft ? button('rename-take', 'Save name', { className: 'icon-button', glyph: 'check', attrs: ` data-id="${esc(take.id)}" aria-label="Save recording name"`, busy }) : ''}</div></div>` : '';
  const content = `${feedback}<p class="draft-state${isDraft ? '' : ' is-saved'}">${isDraft ? 'Not saved yet' : 'Saved'}${icon(isDraft ? 'mic' : 'check')}</p><div class="review-lyric-card">${scene(phrase || 'happy', 'review-scene')}<p id="review-lyrics" class="review-lyrics">${phrase ? renderLyricWords(phrase.text, { busy: true }) : renderLyricWords('My Shiny Teeth and Me', { busy: true })}</p></div>${nameField}<p class="take-meta"><span>${esc(modeName(take.mode))}</span><span>${formatTime(take.duration)}${take.complete ? ', complete' : ', partial'}</span><time>${esc(dateLabel(take.createdAt))}</time></p>${playing ? `<p class="take-playback-status"><span id="take-play-time">${formatTime(ui.perf.currentTime)} / ${formatTime(ui.perf.duration)}</span></p>` : ''}`;
  const play = button(previewAction, preparing ? 'Cancel' : playing ? 'Stop' : 'Play', { glyph: preparing || playing ? 'stop' : 'play', attrs: isDraft ? '' : ` data-id="${esc(take.id)}"`, busy: preparing || playing ? false : busy });
  const again = button('record-again', 'Record Again', { className: 'button button-record', glyph: 'mic', attrs: ` data-id="${esc(take.id)}"`, busy: busy || playing });
  const save = button('save', ui.saving ? 'Saving…' : 'Save', { className: 'button button-yellow', glyph: 'check', busy: busy || playing });
  const download = button('export-take', ui.exporting ? 'Preparing…' : 'Download', { className: 'button button-yellow', glyph: 'download', attrs: ` data-id="${isDraft ? '' : esc(take.id)}"`, busy });
  const recovery = isDraft && !line && (ui.error || ui.perf.error) ? `<div class="draft-tools">${download}</div>` : '';
  const discard = button('discard-recording', isDraft ? 'Discard' : 'Delete line', { className: 'text-button', glyph: 'trash', attrs: ` data-id="${esc(take.id)}"`, busy: busy || playing });
  const footer = `<div class="draft-actions">${play}${line ? again : isDraft ? save : download}</div>${line && isDraft ? `<div class="review-save">${save}</div>` : ''}${line ? `<div class="draft-tools review-discard">${discard}</div>` : ''}${!line && isDraft ? `<div class="draft-tools">${button('record-again', 'Record Again', { className: 'text-button', glyph: 'mic', attrs: ` data-id="${esc(take.id)}"`, busy: busy || playing })}${discard}</div>` : ''}${recovery}${!isDraft && !line ? `<div class="draft-tools">${button('record-again', 'Record Again', { className: 'text-button', glyph: 'mic', attrs: ` data-id="${esc(take.id)}"`, busy: busy || playing })}${button('delete-take', 'Delete recording', { className: 'text-button', glyph: 'trash', attrs: ` data-id="${esc(take.id)}"`, busy: busy || playing })}</div>${deletionConfirmation(ui, take)}` : ''}`;
  return sheet(line ? 'Review your line' : 'Your recording', content, { draft: isDraft, footer });
}
export function renderStudio({ song = {}, phrases = [], sections = [], ui = {}, timeline = [] }) {
  const state = {
    tab: 'practice', phraseId: phrases[0]?.id, rate: 1, listenStatus: 'idle', listenMode: 'spoken', selectedMode: 'guided', phraseRecordMode: 'guided', recordingPhraseId: null, volume: .22, takes: [], saving: false, exporting: false, error: '', notice: '', deleteId: null, sheet: null, word: null, librarySource: 'learn', selectedSections: ['verse1'], reviewTakeId: null, forceRecordPhraseId: null, editingTakeId: null,
    ...ui, perf: { status: 'idle', currentTime: 0, duration: song.duration, countdown: 0, mode: 'guided', canRecord: true, storagePersistent: true, ...ui.perf },
  };
  const draftOpen = Boolean(state.perf.draft && (state.draftOpen ?? !state.sheet));
  const activeSheet = draftOpen ? null : state.sheet;
  const modalOpen = Boolean(draftOpen || activeSheet);
  const captureActive = capturing(state);
  const busy = captureActive || state.saving;
  const message = state.error || state.perf.error || '';
  const feedback = `${message ? `<div class="message message-error" role="alert"><p>${esc(message)}</p></div>` : ''}${state.notice ? `<div class="message message-notice" role="status">${icon('check')}<p>${esc(state.notice)}</p></div>` : ''}`;
  const replayPreparing = state.perf.status === 'preparing' && !captureActive && state.tab !== 'sing' && !draftOpen && !activeSheet;
  const titles = { lines: 'Choose a line', instructions: 'How to play', settings: 'How to play', sections: 'Choose sections', word: 'Word helper', recordings: 'From Sing', coverage: 'Saved lines' };
  let overlay = '';
  if (draftOpen) overlay = reviewSheet(state, phrases, feedback, true);
  else if (activeSheet) {
    if (activeSheet === 'review' || activeSheet === 'take') overlay = reviewSheet(state, phrases, feedback);
    else {
      const content = activeSheet === 'lines' ? lineChoices(phrases, sections, state) : ['settings', 'instructions'].includes(activeSheet) ? instructionsSheet(state) : activeSheet === 'sections' ? sectionsSheet(sections, state) : activeSheet === 'word' ? wordSheet(state) : activeSheet === 'coverage' ? coverageSheet(phrases, sections, state) : recordingsSheet(state);
      overlay = sheet(titles[activeSheet] || 'Recordings', feedback + content, { playing: state.perf.status === 'playing', footer: activeSheet === 'sections' ? button('close-sheet', 'Done', { className: 'button button-yellow sheet-done', glyph: 'check' }) : '' });
    }
  }
  return `<div class="app-shell"><div id="app-workspace" class="app-workspace"${modalOpen ? ' inert aria-hidden="true"' : ''}><header class="app-header"><div class="brand"><span class="brand-mark">${icon('tooth')}</span><span class="brand-name">Shiny Teeth</span></div><div class="header-actions">${state.perf.draft && !draftOpen && state.editingTakeId !== state.perf.draft.id ? button('review-draft', 'Review', { className: 'text-button review-button', attrs: ' aria-haspopup="dialog"', busy: captureActive }) : ''}${button('open-sheet', 'Instructions', { className: 'icon-button', glyph: 'help', attrs: ' data-sheet="instructions" aria-label="Instructions" aria-haspopup="dialog"', busy })}</div></header>
    <main id="main-content" tabindex="-1">${!modalOpen ? feedback : ''}${replayPreparing ? `<div class="message replay-preparing"><p role="status">Preparing playback…</p>${button(state.perf.playbackKind ? 'stop-preview' : 'cancel-record', state.perf.playbackKind ? 'Stop' : 'Cancel', { className: 'text-button', glyph: 'stop' })}</div>` : ''}<div class="studio-content">${state.tab === 'practice' ? practicePanel(phrases, state, timeline) : ''}${performancePanel(song, timeline, sections, state)}${state.tab === 'takes' ? assemblyPanel(song, phrases, state) : ''}</div></main>
    <nav class="studio-tabs" aria-label="Practice navigation">${[['practice', 'book', 'Learn'], ['sing', 'mic', 'Sing'], ['takes', 'folder', 'My Song']].map(([tab, glyph, label]) => `<button type="button" class="studio-tab" data-action="tab" data-tab="${tab}"${state.tab === tab ? ' aria-current="page"' : ''}${disabled(busy)}>${icon(glyph)}<span>${label}</span></button>`).join('')}</nav></div>${overlay}</div>`;
}
