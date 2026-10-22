export const isCapturing = status => ['preparing', 'countdown', 'recording', 'stopping'].includes(status);

export function formatTime(value) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function latestPhraseTakes(takes = []) {
  const latest = new Map();
  const timestamp = take => typeof take.createdAt === 'number' ? take.createdAt : Date.parse(take.createdAt) || 0;
  for (const take of takes) {
    if (!take.phraseId || !take.blob || !Number.isFinite(take.duration) || take.duration <= 0) continue;
    const previous = latest.get(take.phraseId);
    if (!previous || timestamp(take) > timestamp(previous) ||
        (timestamp(take) === timestamp(previous) && String(take.id) > String(previous.id))) latest.set(take.phraseId, take);
  }
  return latest;
}

export function buildTimeline(phrases, sections) {
  const byId = new Map(phrases.map(phrase => [phrase.id, phrase]));
  return sections.flatMap(section => (section.occurrences || []).flatMap((occurrence, index) => {
    const phrase = byId.get(occurrence.phraseId);
    if (!phrase || occurrence.songAvailable === false || !Number.isFinite(occurrence.start) ||
        !Number.isFinite(occurrence.end) || occurrence.end <= occurrence.start) return [];
    return [{ ...phrase, ...occurrence, sectionId: section.id, key: `${section.id}-${index}` }];
  })).sort((a, b) => a.start - b.start || Number(a.isBackingVocal) - Number(b.isBackingVocal));
}

export function subtitleAt(timeline, time = 0) {
  const currentTime = Number.isFinite(time) ? time : 0;
  const active = timeline.filter(line => currentTime >= line.start && currentTime < line.end).reverse();
  const line = active.find(item => !item.isBackingVocal) || active[0];
  const next = timeline.find(item => item.start > currentTime && !item.isBackingVocal) ||
    timeline.find(item => item.start > currentTime);
  if (line) return { ...line, nextText: next?.text || '', isInstrumental: false };
  return {
    text: currentTime < (timeline[0]?.start ?? 0) ? 'Ready to sing?' : next ? 'Music break' : 'Great singing!',
    zh: '', nextText: next?.text || '', phraseId: null, key: null, isInstrumental: true,
  };
}

// A preceding sung line provides a natural cue; the first line uses the intro.
export function musicalLeadInStart(timeline, start) {
  const previous = timeline.filter(line => !line.isBackingVocal && line.start < start - .02).at(-1);
  return previous ? Math.max(0, previous.start) : 0;
}

export function practiceSections(sections, timeline) {
  return sections.flatMap(section => {
    const lines = timeline.filter(line => line.sectionId === section.id && !line.isBackingVocal);
    if (!lines.length) return [];
    const start = Math.min(...lines.map(line => line.start));
    const end = Math.max(...lines.map(line => line.end));
    return [{ ...section, start, end, leadInStart: musicalLeadInStart(timeline, start) }];
  });
}
