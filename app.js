import { SONG, PHRASES, SECTIONS } from './song-data.js?v=ana-child-20261023';
import { LearningEngine } from './engine.js';
import { PerformanceStudio } from './performance.js';
import { renderStudio, renderLyricWords } from './studio-view.js?v=ana-child-20261023';
import { WORDS, renderScene, wordProgress } from './learning-content.js?v=ana-child-20261023';
import { lyricWindowState, updateLyricWindow } from './lyric-window.js';
import { buildTimeline, subtitleAt, formatTime, isCapturing, musicalLeadInStart, practiceSections } from './studio-model.js';

const app = document.querySelector('#app');
const engine = new LearningEngine({ song: SONG, phrases: PHRASES, sections: SECTIONS });
const studio = new PerformanceStudio({ song: SONG, phrases: PHRASES, sections: SECTIONS });
const timeline = buildTimeline(PHRASES, SECTIONS);
const parts = practiceSections(SECTIONS, timeline);
const ui = {
  tab: 'practice', phraseId: PHRASES[0].id, rate: 1,
  listenStatus: 'idle', listenMode: 'spoken', selectedMode: 'guided', volume: .28,
  perf: { ...studio.state }, takes: [], saving: false, exporting: false,
  error: '', notice: '', deleteId: null, phraseRecordMode: 'guided', recordingPhraseId: null,
  loadingTakes: true, sheet: null, draftOpen: false, word: null, librarySource: 'learn',
  selectedSections: [parts[0].id], activeSectionId: parts[0].id, reviewTakeId: null, referencePhraseId: null,
  referenceRange: null, forceRecordPhraseId: null, editingTakeId: null, libraryScroll: 0,
};
let noticeTimer, sheetOpener = null, lastPerfSignature = '', wordAudio = null;
let takeRequest = 0;
let wordReturn = null;
const capturing = () => isCapturing(ui.perf.status) && !ui.perf.playbackKind;
const takeById = id => ui.perf.draft?.id === id ? ui.perf.draft : ui.takes.find(take => take.id === id);
const selectedParts = () => parts.filter(part => ui.selectedSections.includes(part.id));
const activePart = () => selectedParts().find(part => part.id === ui.activeSectionId) || selectedParts()[0];

function render() {
  const focused = document.activeElement;
  const focusKey = app.contains(focused) ? {
    id: focused.id, action: focused.dataset.action, item: focused.dataset.id,
    tab: focused.dataset.tab, mode: focused.dataset.mode, scope: focused.dataset.scope, source: focused.dataset.source, sheet: focused.dataset.sheet, word: focused.dataset.word,
  } : null;
  const sheetScroll = app.querySelector('.sheet-scroll')?.scrollTop || 0;
  ui.libraryScroll = app.querySelector('.line-library-scroll')?.scrollTop ?? ui.libraryScroll;
  app.innerHTML = renderStudio({ song: SONG, phrases: PHRASES, sections: SECTIONS, ui, timeline });
  const scrollArea = app.querySelector('.sheet-scroll');
  if (scrollArea) scrollArea.scrollTop = sheetScroll;
  const library = app.querySelector('.line-library-scroll');
  if (library) library.scrollTop = ui.libraryScroll;
  let restored = false;
  if (focusKey) {
    const same = [...app.querySelectorAll('button, select, input')].find(element => focusKey.id ? element.id === focusKey.id :
      focusKey.action && element.dataset.action === focusKey.action && element.dataset.id === focusKey.item &&
      element.dataset.tab === focusKey.tab && element.dataset.mode === focusKey.mode && element.dataset.scope === focusKey.scope && element.dataset.source === focusKey.source && element.dataset.sheet === focusKey.sheet && element.dataset.word === focusKey.word);
    if (same && !same.disabled) { same.focus({ preventScroll: true }); restored = document.activeElement === same; }
  }
  updateLive(); focusSheet();
  if (focusKey && !restored && !app.querySelector('[role="dialog"]')) {
    if (capturing()) focusVisible('[data-action="cancel-record"], [data-action="stop-record"]');
    else if (ui.perf.status === 'playing') focusVisible('[data-action="stop-preview"]');
    else if (['loading', 'playing'].includes(ui.listenStatus)) focusVisible('[data-action="stop-listen"]');
    else focusPrimary();
  }
}
function text(id, value) {
  const node = document.getElementById(id);
  if (node && node.textContent !== String(value)) node.textContent = value;
}
function sheetFocusables(dialog) {
  return [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')]
    .filter(node => node.getClientRects().length > 0);
}
function focusVisible(selector, root = app) {
  const target = [...root.querySelectorAll(selector)].find(node => !node.disabled && node.getClientRects().length > 0 && !node.closest('[hidden], [inert]'));
  target?.focus({ preventScroll: true }); return target;
}
function focusSheet() {
  const dialog = app.querySelector('[role="dialog"]');
  if (!dialog || dialog.contains(document.activeElement)) return;
  const target = dialog.querySelector('[data-action="stop-preview"]:not(:disabled)') || dialog.querySelector('[tabindex="-1"]') || sheetFocusables(dialog)[0] || dialog;
  if (target === dialog) dialog.tabIndex = -1;
  target.focus({ preventScroll: true });
}
function stopWord() { if (wordAudio) { wordAudio.pause(); wordAudio.src = ''; wordAudio = null; } }
function closeSheet() {
  studio.stopPlayback(); stopWord();
  const returnTo = ui.sheet === 'word' ? wordReturn : null;
  ui.sheet = returnTo?.sheet || null; ui.draftOpen = Boolean(returnTo?.draftOpen && ui.perf.draft); ui.deleteId = null; ui.word = null; wordReturn = null;
  render();
  const target = sheetOpener === 'word' ? focusVisible(`[data-action="word"][data-word="${ui.lastWord || ''}"]`) :
    [...app.querySelectorAll('[data-action="open-sheet"]')].find(node => node.dataset.sheet === sheetOpener);
  (target || focusPrimary())?.focus({ preventScroll: true });
}
function focusPrimary() {
  const action = { practice: 'record-line', sing: 'record', takes: 'play-assembly' }[ui.tab];
  return focusVisible(`[data-action="${action}"], [data-action="review-line"], [data-action="open-take"]`);
}
app.addEventListener('keydown', event => {
  const dialog = app.querySelector('[role="dialog"]');
  if (!dialog) return;
  if (event.key === 'Escape') { event.preventDefault(); closeSheet(); return; }
  if (event.key !== 'Tab') return;
  const focusables = sheetFocusables(dialog), first = focusables[0], last = focusables.at(-1);
  if (!first) { event.preventDefault(); return; }
  if (!focusables.includes(document.activeElement) || event.shiftKey && document.activeElement === first) {
    event.preventDefault(); (event.shiftKey ? last : first).focus();
  } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

function paintLyrics(id, line, time, active) {
  const node = document.getElementById(id);
  if (!node) return;
  if (node.dataset.lyricText !== line.text) {
    node.innerHTML = line.phraseId || line.id ? renderLyricWords(line.text, { busy: capturing() }) : line.text;
    node.dataset.lyricText = line.text;
  }
  const progress = active && Number.isFinite(line.start) ? wordProgress(line, line.start, line.end, time) : [];
  for (const word of node.querySelectorAll('.lyric-word')) {
    const amount = progress[Number(word.dataset.wordIndex)] || 0;
    word.style.setProperty('--word-progress', `${Math.round(amount * 1000) / 10}%`);
    word.classList.toggle('is-sung', amount >= 1);
    word.classList.toggle('is-singing', amount > 0 && amount < 1);
  }
}
function paintScene(id, line) {
  const scene = document.getElementById(id);
  const key = line.id || line.phraseId || 'music';
  if (scene && scene.dataset.scene !== key) { scene.innerHTML = renderScene(line); scene.dataset.scene = key; }
}
function paintWindow(id, options, active) {
  const state = lyricWindowState(timeline, options);
  const node = document.getElementById(id);
  if (!node || node.closest('[hidden]')) return state;
  const row = updateLyricWindow(node, state, { prefix: id === 'phrase-window' ? 'phrase' : 'live', renderWords: renderLyricWords, interactive: !capturing() });
  if (row && state.current) {
    const amounts = active && state.inTarget ? wordProgress(state.current, state.current.start, state.current.end, options.time) : [];
    for (const word of row.querySelectorAll('.lyric-word')) {
      const amount = amounts[Number(word.dataset.wordIndex)] || 0;
      word.style.setProperty('--word-progress', `${Math.round(amount * 1000) / 10}%`);
      word.classList.toggle('is-sung', amount >= 1);
      word.classList.toggle('is-singing', amount > 0 && amount < 1);
    }
  }
  return state;
}
function updateLive() {
  const perf = ui.perf;
  const active = perf.status === 'playing' || capturing() && ['recording', 'countdown'].includes(perf.status);
  const absolute = Number.isFinite(perf.absoluteTime) ? perf.absoluteTime : (perf.rangeStart || 0) + perf.currentTime;
  const selected = PHRASES.find(phrase => phrase.id === ui.phraseId);
  const part = activePart();
  const reference = perf.playbackKind === 'reference' ? ui.referenceRange : null;
  const sectionStart = reference?.kind === 'section' ? reference.targetStart : active && !perf.phraseId && perf.playbackKind !== 'assembly' ? perf.rangeStart : part?.start || 0;
  const sectionEnd = reference?.kind === 'section' ? reference.targetEnd : active && !perf.phraseId && perf.playbackKind !== 'assembly' ? perf.rangeEnd : part?.end || SONG.duration;
  const singState = paintWindow('live-window', { time: active ? absolute : sectionStart, targetStart: sectionStart, targetEnd: sectionEnd, idle: !active }, active);
  paintScene('live-scene', singState.current || selected || {});
  const lineActive = active && (perf.playbackKind === 'reference' ? reference?.kind === 'line' && ui.referencePhraseId === ui.phraseId : perf.phraseId === ui.phraseId);
  const phraseState = selected ? paintWindow('phrase-window', { time: lineActive ? absolute : selected.start, targetStart: selected.start, targetEnd: selected.end, phraseId: selected.id, idle: !lineActive }, lineActive) : null;
  if (phraseState?.current) paintScene('phrase-scene', phraseState.current);
  const currentState = ui.tab === 'practice' ? phraseState : singState;
  const leadIn = Boolean(active && currentState?.leadIn);
  for (const card of app.querySelectorAll('.phrase-card, .performance-card')) card.classList.toggle('is-lead-in', leadIn);
  const wholeState = lyricWindowState(timeline, { time: absolute, targetStart: perf.playbackKind === 'take' ? perf.rangeStart : 0, targetEnd: perf.playbackKind === 'take' ? perf.rangeEnd : SONG.duration, phraseId: perf.playbackKind === 'take' ? perf.phraseId : null, idle: false });
  if (perf.playbackKind === 'assembly' || perf.playbackKind === 'take') {
    const line = wholeState.current;
    if (line) { paintLyrics('assembly-lyrics', line, absolute, active); paintScene('assembly-scene', line); }
  }
  text('live-translation', ''); text('live-next', ''); text('live-countdown', ''); text('phrase-record-countdown', '');
  text('live-time', `${formatTime(active ? perf.currentTime : 0)} / ${formatTime(active ? perf.duration : sectionEnd - sectionStart)}`);
  text('take-play-time', `${formatTime(perf.currentTime)} / ${formatTime(perf.duration)}`);
  text('assembly-play-time', `${formatTime(active && perf.playbackKind === 'assembly' ? perf.currentTime : 0)} / ${formatTime(SONG.duration)}`);
  text('phrase-record-time', `${formatTime(perf.currentTime)} / ${formatTime(perf.duration)}`);
  const status = leadIn ? 'Listen first' : {
    idle: '', preparing: 'Loading…', countdown: 'Listen first', recording: 'Your turn',
    stopping: 'Finishing…', draft: '', playing: perf.playbackKind === 'reference' ? 'Listen' : 'Playing', error: 'Try again',
  }[perf.status] || '';
  text('live-status', status); text('phrase-record-status', status);
  const progress = document.getElementById('live-progress');
  if (progress) {
    progress.max = active ? perf.duration || SONG.duration : sectionEnd - sectionStart;
    progress.value = active ? perf.currentTime || 0 : 0;
    progress.setAttribute('aria-valuetext', `${formatTime(progress.value)} of ${formatTime(progress.max)}`);
  }
  const review = ui.perf.draft?.id === ui.reviewTakeId ? ui.perf.draft : takeById(ui.reviewTakeId);
  if (review) {
    const reviewState = lyricWindowState(timeline, { time: active ? absolute : review.rangeStart || 0, targetStart: review.rangeStart || 0, targetEnd: review.rangeEnd || SONG.duration, phraseId: review.phraseId, idle: !active });
    if (reviewState.current) { paintLyrics('review-lyrics', reviewState.current, absolute, active); paintScene('review-scene', reviewState.current); }
  }
}

function clearMessages() { ui.error = ''; ui.notice = ''; clearTimeout(noticeTimer); }
function notify(message) {
  ui.notice = message; render(); clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { ui.notice = ''; render(); }, 5000);
}
function errorMessage(error) { return typeof error === 'string' ? error : error?.message || 'Something went wrong. Try again.'; }
function stopLine() { engine.stop(); ui.listenStatus = 'idle'; stopWord(); }
function stopAllPlayback() { stopLine(); studio.stopPlayback(); ui.referencePhraseId = null; ui.referenceRange = null; }
async function refreshTakes() {
  const request = ++takeRequest; ui.loadingTakes = true;
  try { const takes = await studio.listTakes(); if (request === takeRequest) ui.takes = takes; }
  catch (error) { if (request === takeRequest) ui.error = errorMessage(error); }
  finally { if (request === takeRequest) { ui.loadingTakes = false; render(); } }
}
function selectPhrase(id) {
  if (!PHRASES.some(phrase => phrase.id === id)) return;
  stopAllPlayback(); ui.forceRecordPhraseId = null; ui.editingTakeId = null; ui.phraseId = id; ui.tab = 'practice'; ui.sheet = null; ui.draftOpen = false; clearMessages(); render();
}
async function listen(mode) {
  if (capturing()) return;
  stopAllPlayback(); clearMessages(); ui.listenMode = mode;
  if (mode === 'spoken') await engine.play({ mode, phraseIds: [ui.phraseId], rate: ui.rate });
  else {
    const phrase = PHRASES.find(item => item.id === ui.phraseId);
    if (!Number.isFinite(phrase?.start) || !Number.isFinite(phrase?.end)) throw new Error('Song timing is unavailable for this line. Try Read.');
    ui.referencePhraseId = ui.phraseId; ui.referenceRange = { kind: 'line', targetStart: phrase.start, targetEnd: phrase.end, phraseId: phrase.id }; ui.listenStatus = 'loading'; render();
    await studio.playReference({ mode: 'guided', start: phrase.start, end: phrase.end, rate: ui.rate });
  }
}
async function pronounce(key) {
  const word = WORDS[key]; if (!word) return;
  stopAllPlayback(); wordAudio = new Audio(word.audioUrl);
  try { await wordAudio.play(); }
  catch { throw new Error('Could not play this word. Try again.'); }
}
async function recordLine(phraseId = ui.phraseId, mode = ui.phraseRecordMode) {
  const phrase = PHRASES.find(item => item.id === phraseId);
  if (!phrase || !Number.isFinite(phrase.start) || !Number.isFinite(phrase.end)) throw new Error('Recording is unavailable for this line.');
  stopAllPlayback(); clearMessages(); ui.renameValue = undefined; ui.phraseId = phrase.id; ui.tab = 'practice'; ui.recordingPhraseId = phrase.id; ui.sheet = null; ui.draftOpen = false;
  await studio.start({ mode, volume: ui.volume, phraseId: phrase.id, start: phrase.start, end: phrase.end, leadInStart: musicalLeadInStart(timeline, phrase.start) });
}
async function recordSection(take = null) {
  const retry = take || ui.retrySingRange;
  const part = retry ? { start: retry.rangeStart ?? retry.start ?? 0, end: retry.rangeEnd ?? retry.end ?? SONG.duration, id: retry.sectionIds?.[0] } : activePart();
  if (!part) { notify('Choose a section first.'); return; }
  stopAllPlayback(); clearMessages(); ui.renameValue = undefined; ui.tab = 'sing'; ui.recordingPhraseId = null; ui.sheet = null; ui.draftOpen = false;
  await studio.start({ mode: take?.mode === 'instrumental' ? 'instrumental' : take ? 'guided' : ui.selectedMode,
    volume: ui.volume, start: part.start, end: part.end, leadInStart: musicalLeadInStart(timeline, part.start), sectionIds: part.id ? [part.id] : [] });
}
async function exportTake(id, assembly = false) {
  if (ui.exporting) return;
  ui.exporting = true; clearMessages(); render();
  try {
    const blob = assembly ? await studio.exportAssembly() : await studio.exportMix(id || undefined);
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `shiny-teeth-${assembly ? 'full-song-' : ''}${new Date().toISOString().slice(0,10)}.wav`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000); ui.notice = 'Your WAV download is ready.';
  } finally { ui.exporting = false; render(); }
}
function openReview(id) {
  stopAllPlayback(); ui.renameValue = undefined; ui.reviewTakeId = id; const take = takeById(id);
  ui.draftOpen = ui.perf.draft?.id === id; ui.sheet = take?.phraseId ? 'review' : 'take'; sheetOpener = 'draft'; render();
}
app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'section-toggle' && button.tagName === 'INPUT') return; // handled once on change
  if (capturing() && !['stop-record', 'cancel-record', 'close-sheet'].includes(action)) return;
  if (ui.saving && action !== 'stop-preview') return;
  try {
    switch (action) {
      case 'open-sheet': stopAllPlayback(); sheetOpener = button.dataset.sheet; ui.sheet = sheetOpener; ui.draftOpen = false; render(); break;
      case 'close-sheet': closeSheet(); break;
      case 'review-draft': if (ui.perf.draft) openReview(ui.perf.draft.id); break;
      case 'review-line': case 'open-take': openReview(button.dataset.id); break;
      case 'tab':
        stopAllPlayback(); ui.editingTakeId = null; ui.tab = button.dataset.tab; clearMessages(); ui.deleteId = null; ui.sheet = null; ui.draftOpen = false; render();
        if (ui.tab === 'takes') await refreshTakes(); break;
      case 'phrase': selectPhrase(button.dataset.id); break;
      case 'previous': case 'next': {
        const index = PHRASES.findIndex(phrase => phrase.id === ui.phraseId);
        selectPhrase(PHRASES[Math.max(0, Math.min(PHRASES.length - 1, index + (action === 'next' ? 1 : -1)))].id); break;
      }
      case 'speak': await listen('spoken'); break;
      case 'sing-line': await listen('song'); break;
      case 'stop-listen': stopAllPlayback(); render(); break;
      case 'mode':
        ui[button.dataset.scope === 'line' ? 'phraseRecordMode' : 'selectedMode'] = button.dataset.mode === 'instrumental' ? 'instrumental' : 'guided'; clearMessages(); render(); break;
      case 'play-section': {
        const part = activePart(); if (!part) { notify('Choose a section first.'); break; }
        stopAllPlayback(); clearMessages();
        ui.referenceRange = { kind: 'section', targetStart: part.start, targetEnd: part.end };
        await studio.playReference({ mode: 'guided', start: part.leadInStart, end: part.end }); break;
      }
      case 'record': await recordSection(); break;
      case 'record-line': await recordLine(); break;
      case 'record-again': {
        const take = takeById(button.dataset.id || ui.reviewTakeId) || ui.perf.draft;
        if (!take) break;
        stopAllPlayback(); clearMessages(); ui.renameValue = undefined; ui.editingTakeId = take.id;
        ui.sheet = null; ui.draftOpen = false; wordReturn = null;
        if (take.phraseId) {
          ui.tab = 'practice'; ui.phraseId = take.phraseId; ui.forceRecordPhraseId = take.phraseId;
          ui.phraseRecordMode = take.mode === 'instrumental' ? 'instrumental' : 'guided';
        } else {
          ui.tab = 'sing'; ui.selectedMode = take.mode === 'instrumental' ? 'instrumental' : 'guided';
          const ids = take.sectionIds?.filter(id => parts.some(part => part.id === id)) || [];
          if (ids.length) { ui.selectedSections = ids; ui.activeSectionId = ids[0]; }
          ui.retrySingRange = { start: take.rangeStart || 0, end: take.rangeEnd ?? SONG.duration, sectionIds: take.sectionIds || [] };
        }
        render(); focusPrimary(); break;
      }
      case 'stop-record': case 'cancel-record': await studio.stopRecording(); break;
      case 'preview': stopLine(); clearMessages(); await studio.replay(); break;
      case 'stop-preview': studio.stopPlayback(); break;
      case 'save': {
        const name = app.querySelector('#take-name')?.value.trim();
        ui.renameValue = name; ui.saving = true; clearMessages(); render();
        try {
          const saved = await studio.saveDraft({ name }); await refreshTakes();
          ui.sheet = null; ui.draftOpen = false; ui.reviewTakeId = saved.id; ui.renameValue = undefined; ui.forceRecordPhraseId = null; ui.editingTakeId = null; ui.retrySingRange = null;
          if (!saved.phraseId) {
            const queue = selectedParts(), index = queue.findIndex(part => saved.sectionIds?.includes(part.id));
            if (index >= 0 && index < queue.length - 1) { ui.activeSectionId = queue[index + 1].id; ui.notice = 'Saved. Your next section is ready.'; }
            else ui.notice = 'Saved to My Song · From Sing.';
          } else ui.notice = 'Line saved. Tap Review to listen or record again.';
        } finally { ui.saving = false; render(); focusPrimary(); } break;
      }
      case 'discard-recording': {
        if (ui.exporting) break;
        const take = takeById(button.dataset.id || ui.reviewTakeId); if (!take) break;
        stopAllPlayback(); clearMessages();
        if (take.id === ui.perf.draft?.id) studio.discardDraft();
        else if (take.phraseId) {
          ui.saving = true; render();
          try { await studio.discardLine(take.phraseId); await refreshTakes(); }
          finally { ui.saving = false; }
        } else break;
        if (take.phraseId) { ui.tab = 'practice'; ui.phraseId = take.phraseId; ui.forceRecordPhraseId = take.phraseId; }
        else ui.tab = 'sing';
        ui.editingTakeId = null; ui.reviewTakeId = null; ui.sheet = null; ui.draftOpen = false;
        render(); focusPrimary(); break;
      }
      case 'replay-line': stopAllPlayback(); clearMessages(); await studio.replay(button.dataset.id); break;
      case 'replay-take': stopLine(); clearMessages(); await studio.replay(button.dataset.id); break;
      case 'play-assembly': stopAllPlayback(); clearMessages(); ui.sheet = null; await studio.replayAssembly(); break;
      case 'export-assembly': await exportTake(undefined, true); break;
      case 'export-take': await exportTake(button.dataset.id); break;
      case 'library-source': stopAllPlayback(); ui.librarySource = button.dataset.source === 'sing' ? 'sing' : 'learn'; render(); break;
      case 'word': {
        const key = button.dataset.word; if (!WORDS[key]) break;
        wordReturn = { sheet: ui.sheet, draftOpen: ui.draftOpen };
        stopAllPlayback(); ui.word = key; ui.lastWord = key; ui.sheet = 'word'; ui.draftOpen = false; sheetOpener = 'word'; render(); await pronounce(key); break;
      }
      case 'pronounce-word': await pronounce(button.dataset.word || ui.word); break;
      case 'rename-take': {
        const name = app.querySelector('#take-name')?.value.trim();
        if (!name) { notify('Give your recording a name.'); break; }
        clearMessages(); ui.renameValue = name;
        await studio.renameTake(button.dataset.id || ui.reviewTakeId, name); ui.renameValue = undefined; await refreshTakes(); notify('Name saved.'); break;
      }
      case 'delete-take': ui.deleteId = button.dataset.id; render(); break;
      case 'cancel-delete': ui.deleteId = null; render(); break;
      case 'confirm-delete': await studio.deleteTake(button.dataset.id); ui.deleteId = null; await refreshTakes(); notify('Recording deleted.'); break;
    }
  } catch (error) { ui.error = errorMessage(error); render(); }
});
app.addEventListener('change', event => {
  if (event.target.id === 'line-rate') { ui.rate = Number(event.target.value) || 1; stopAllPlayback(); render(); }
  if (event.target.dataset.action === 'section-toggle') {
    stopAllPlayback(); ui.retrySingRange = null; const id = event.target.dataset.id;
    ui.selectedSections = event.target.checked ? [...new Set([...ui.selectedSections, id])] : ui.selectedSections.filter(item => item !== id);
    if (!ui.selectedSections.includes(ui.activeSectionId)) ui.activeSectionId = selectedParts()[0]?.id || null;
    render();
  }
});
// A horizontal swipe moves the same two-option backing control as a tap.
let swipe = null;
app.addEventListener('touchstart', event => {
  const control = event.target.closest('.mode-switch, .segment-control, .backing-switch');
  if (control && !capturing()) swipe = { control, x: event.touches[0].clientX, y: event.touches[0].clientY };
}, { passive: true });
app.addEventListener('touchend', event => {
  if (!swipe) return;
  const dx = event.changedTouches[0].clientX - swipe.x, dy = event.changedTouches[0].clientY - swipe.y;
  if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    const buttons = swipe.control.querySelectorAll('[data-action="mode"]');
    buttons[dx < 0 ? buttons.length - 1 : 0]?.click();
  }
  swipe = null;
}, { passive: true });
engine.addEventListener('statechange', event => {
  const previous = ui.listenStatus; ui.listenStatus = event.detail.status;
  if (event.detail.error) ui.error = event.detail.error;
  if (previous !== ui.listenStatus) render();
});
studio.addEventListener('statechange', event => {
  const oldDraft = ui.perf.draft?.id, wasCapturing = capturing(); ui.perf = { ...event.detail };
  if (wasCapturing && !capturing()) ui.editingTakeId = null;
  if (!capturing()) ui.recordingPhraseId = null;
  if (ui.perf.playbackKind === 'reference') ui.listenStatus = ui.perf.status === 'playing' ? 'playing' : ui.perf.status === 'preparing' ? 'loading' : 'idle';
  else if (ui.listenMode === 'song') ui.listenStatus = 'idle';
  if (!ui.perf.draft) ui.draftOpen = false;
  else if (ui.perf.draft.id !== oldDraft) {
    ui.forceRecordPhraseId = null; ui.editingTakeId = null;
    ui.reviewTakeId = ui.perf.draft.id; ui.sheet = ui.perf.draft.phraseId ? 'review' : 'take'; ui.draftOpen = true; sheetOpener = 'draft';
  }
  const signature = JSON.stringify([ui.perf.status, ui.perf.draft?.id, ui.perf.activeTakeId, ui.perf.error, ui.perf.canRecord, ui.perf.leadIn]);
  if (signature !== lastPerfSignature) { lastPerfSignature = signature; render(); } else updateLive();
});
studio.addEventListener('takeschange', () => { refreshTakes(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  stopLine();
  if (capturing()) studio.stopRecording().then(() => { ui.notice = ui.perf.draft ? 'Recording stopped. Review your take.' : 'Recording stopped.'; render(); }).catch(error => { ui.error = errorMessage(error); render(); });
  else studio.stopPlayback();
});
window.addEventListener('beforeunload', event => { if (ui.perf.draft || capturing()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', event => { if (!event.persisted) { stopWord(); engine.destroy(); studio.destroy(); } });
window.addEventListener('resize', updateLive);
document.fonts?.ready.then(updateLive);
render(); refreshTakes();
