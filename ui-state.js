// Keep captions, lyric timing, and controls consistent for every audio source.
export function getPlaybackPresentation(state, phaseId) {
  const liveRecording = state.mode === 'recording' && state.status === 'recording';
  const liveFullRecording = liveRecording && phaseId === 6;
  const recordingPlayback = state.mode === 'recording' && !liveRecording;
  const timedMode = ['song', 'echo', 'melody', 'chant'].includes(state.mode);
  const unaligned = (state.trackAligned === false && timedMode) || (liveFullRecording && state.trackAligned !== true);
  let trackLabel = state.trackAligned === false ? state.activeTrackLabel || state.trackLabel || '本地音轨' : '原唱';
  let syncCaption = unaligned ? '本地音轨 · 无同步歌词' : phaseId === 6 ? '跟着音乐，自由加入' : '原唱示范';
  if (liveRecording) {
    trackLabel = liveFullRecording ? state.trackLabel || state.activeTrackLabel || '原唱' : '正在录音';
    syncCaption = liveFullRecording ? unaligned ? '本地伴奏 · 录音中，无同步歌词' : '原唱伴唱 · 正在录音' : '清唱录音 · 无同步歌词';
  } else if (recordingPlayback) {
    trackLabel = '我的录音';
    syncCaption = '录音回放 · 无同步歌词';
  } else if (state.mode === 'spoken') {
    trackLabel = '清晰朗读示范';
    syncCaption = state.activeTrackLabel === '设备英语朗读' ? '设备英语朗读 · 发音和意思' : '先听发音和意思';
  } else if (state.mode === 'chant') {
    trackLabel = '节奏念词示范';
    syncCaption = '合成朗读 · 无演唱旋律';
  } else if (state.mode === 'melody') {
    trackLabel = '无词旋律示范';
    syncCaption = '听旋律，轻轻哼唱';
  } else if (state.mode === 'beat') {
    trackLabel = state.capabilities?.beatAligned ? '歌曲拍点' : '均匀拍点';
    syncCaption = state.capabilities?.beatAligned ? '已校准歌曲节拍' : '独立均匀拍点';
  }
  return {
    hasTimedLyrics: (state.trackAligned !== false && timedMode && ['playing', 'paused', 'waiting'].includes(state.status)) || (liveFullRecording && state.trackAligned === true),
    unaligned,
    liveRecording,
    liveFullRecording,
    recordingPlayback,
    trackLabel,
    syncCaption,
    canSeek: ['song', 'echo'].includes(state.mode) && !['recording', 'loading'].includes(state.status),
  };
}
