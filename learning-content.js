// Small, offline learning helpers. IPA is broad American English; Chinese glosses
// describe the meaning used in this song, rather than every dictionary sense.
export const DICTIONARY_SOURCES = Object.freeze([
  'https://dictionary.cambridge.org/us/dictionary/english/uncharted',
  'https://dictionary.cambridge.org/pronunciation/english/gargle',
  'https://dictionary.cambridge.org/pronunciation/english/pearly',
  'https://dictionary.cambridge.org/pronunciation/english/twinkle',
  'https://dictionary.cambridge.org/pronunciation/english/floss',
  'https://dictionary.cambridge.org/us/pronunciation/english/glisten',
]);

export const normalizeWord = value => String(value ?? '').replace(/[’‘]/g, "'").toLowerCase();
export const wordAudioUrl = key => `./assets/audio/words/${normalizeWord(key).replace(/'/g, '')}.mp3`;

const vocabulary = {
  a: ['ə', '一个；一'], adding: ['ˈædɪŋ', '增添；使更多'], all: ['ɔːl', '全部；所有'], an: ['ən', '一个（用在元音前）'],
  and: ['ænd', '和；而且'], as: ['æz', '像；如同'], awesome: ['ˈɑːsəm', '特别棒的'], be: ['biː', '是；成为'],
  beauty: ['ˈbjuːt̬i', '美；美丽'], bones: ['boʊnz', '骨头（这里比喻牙齿）'], breath: ['breθ', '呼出的气；口气'], brush: ['brʌʃ', '刷；刷牙'],
  by: ['baɪ', '靠；由（by myself：独自）'], can: ['kæn', '能；可以'], christmas: ['ˈkrɪsməs', '圣诞节'], couple: ['ˈkʌpəl', '两个；几个'],
  "don't": ['doʊnt', '不（do not 的缩写）'], endless: ['ˈendləs', '无边无际的'], face: ['feɪs', '脸'], favorite: ['ˈfeɪvərɪt', '最喜欢的'],
  feeling: ['ˈfiːlɪŋ', '感觉；感到'], fills: ['fɪlz', '装满；充满'], flaw: ['flɑː', '瑕疵；缺点'], floss: ['flɑːs', '用牙线清洁牙缝'],
  gargle: ['ˈɡɑːrɡəl', '漱口；含漱'], glee: ['ɡliː', '欢喜；开心'], glisten: ['ˈɡlɪsən', '闪着光泽'], got: ['ɡɑːt', '得到；拥有'],
  grow: ['ɡroʊ', '生长；变得'], happy: ['ˈhæpi', '开心的'], have: ['hæv', '有；拥有'], i: ['aɪ', '我'],
  "i'm": ['aɪm', '我是；我感到（I am 的缩写）'], "i've": ['aɪv', '我有（I have 的缩写）'], in: ['ɪn', '在……里面'], island: ['ˈaɪlənd', '岛；小岛'],
  jaw: ['dʒɑː', '颌；下巴'], just: ['dʒʌst', '就；只是'], know: ['noʊ', '知道'], like: ['laɪk', '像；如同'],
  lonely: ['ˈloʊnli', '孤单的'], love: ['lʌv', '爱；喜爱'], makes: ['meɪks', '使；让'], me: ['miː', '我（用作宾语）'],
  mile: ['maɪl', '英里（约一点六公里）'], mints: ['mɪnts', '薄荷糖'], my: ['maɪ', '我的'], myself: ['maɪˈself', '我自己'],
  pearly: ['ˈpɝːli', '珍珠般的'], perfect: ['ˈpɝːfɪkt', '完美的'], real: ['ˈriːəl', '真正的；很（口语）'], rinse: ['rɪns', '用水冲洗；漱口'],
  sad: ['sæd', '难过的'], sea: ['siː', '海；大海'], see: ['siː', '看见'], shiny: ['ˈʃaɪni', '闪亮的'],
  should: ['ʃʊd', '应该'], smile: ['smaɪl', '微笑'], so: ['soʊ', '那么；所以'], song: ['sɑːŋ', '歌；歌曲'],
  space: ['speɪs', '太空'], sparkle: ['ˈspɑːrkəl', '闪耀；闪闪发光'], stars: ['stɑːrz', '星星'], strong: ['strɑːŋ', '强壮的；坚固的'],
  talk: ['tɑːk', '说话；交谈'], teeth: ['tiːθ', '牙齿（tooth 的复数）'], that: ['ðæt', '那；这里连接后面的描述'], the: ['ðə', '这；那（表示特指）'],
  them: ['ðem', '他们；它们（用作宾语）'], they: ['ðeɪ', '他们；它们'], "they'd": ['ðeɪd', '他们会（they would 的缩写）'],
  "they'll": ['ðeɪl', '他们将会（they will 的缩写）'], "they're": ['ðer', '他们是（they are 的缩写）'], those: ['ðoʊz', '那些'],
  to: ['tuː', '到；去；用在动词前'], tree: ['triː', '树'], twinkle: ['ˈtwɪŋkəl', '一闪一闪；闪烁'], uncharted: ['ʌnˈtʃɑːrtɪd', '地图上未标出的；未知的'],
  up: ['ʌp', '向上；完全（fill up：充满）'], walk: ['wɑːk', '走路；步行'], what: ['wʌt', '什么'], when: ['wen', '当……时候'],
  white: ['waɪt', '白色的'], why: ['waɪ', '为什么'], with: ['wɪð', '和；带着'], woo: ['wuː', '呜呼！（欢呼声）'],
  yes: ['jes', '是的；对'], you: ['juː', '你；你们'], your: ['jʊr', '你的；你们的'], '32': ['ˌθɝːt̬i ˈtuː', '三十二'],
};
export const WORDS = Object.freeze(Object.fromEntries(Object.entries(vocabulary).map(([key, [ipa, zh]]) => [key, Object.freeze({ ipa: `/${ipa}/`, zh, meaning: zh, audioUrl: wordAudioUrl(key) })])));

/** Original text is retained exactly, including whitespace and punctuation. */
export function tokenizeLyric(text = '') {
  const tokens = [];
  const input = String(text ?? '');
  const pattern = /[A-Za-z]+(?:['’‘][A-Za-z]+)*|\d+/g;
  let cursor = 0, wordIndex = 0;
  for (const match of input.matchAll(pattern)) {
    if (match.index > cursor) tokens.push({ text: input.slice(cursor, match.index), key: '', isWord: false, wordIndex: null });
    tokens.push({ text: match[0], key: normalizeWord(match[0]), isWord: true, wordIndex: wordIndex++ });
    cursor = match.index + match[0].length;
  }
  if (cursor < input.length) tokens.push({ text: input.slice(cursor), key: '', isWord: false, wordIndex: null });
  return tokens;
}

const colors = { sky: '#d9e7e4', sea: '#b9d8d6', seaLine: '#8ab6b2', sand: '#eddbb1', green: '#a2c1a5', ink: '#7b9a8b', rose: '#dfb5aa', sun: '#efcf83', white: '#fffdf1' };
const path = (d, fill = 'none', stroke = colors.ink, width = 3) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const circle = (x, y, r, fill, stroke = 'none', width = 2) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
const sparkle = (x, y, size = 11, fill = colors.sun) => path(`M${x} ${y - size}Q${x} ${y} ${x + size} ${y}Q${x} ${y} ${x} ${y + size}Q${x} ${y} ${x - size} ${y}Q${x} ${y} ${x} ${y - size}Z`, fill, fill, 1);
const heart = (x, y, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})">${path('M0 9C-25-9-28-25-15-29-7-32-2-27 0-22 4-29 10-33 19-28 33-18 20-3 0 9Z', colors.rose, colors.rose, 1)}</g>`;
const tooth = (x, y, scale = 1, happy = true) => `<g transform="translate(${x} ${y}) scale(${scale})">${path('M-25-38C-52-40-48-5-35 23-30 38-22 51-13 32L-3 10Q0 3 5 12L15 34C24 52 33 35 38 18 49-11 48-45 23-39 13-37 6-30-2-33-10-36-17-39-25-38Z', colors.white, colors.ink, 2.6)}${happy ? `${circle(-14, -8, 2.5, colors.ink)}${circle(16, -8, 2.5, colors.ink)}${path('M-12 3Q1 16 15 2', 'none', colors.ink, 2.5)}` : ''}</g>`;
const cloud = (x, y, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})">${path('M-34 15C-56 13-55-13-36-17-36-39-3-42 5-22 25-36 46-18 41-4 65 6 50 27 32 25H-31Z', colors.sky, colors.sky, 1)}</g>`;
const waves = () => `${path('M0 224Q40 209 80 224T160 224T240 224T320 224T400 224T480 224V300H0Z', colors.sea, colors.sea, 1)}${path('M12 246Q35 236 58 246M102 264Q133 251 164 264M257 244Q288 231 320 244M379 271Q416 258 453 271', 'none', colors.seaLine, 2)}`;
const mouth = (x, y, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})">${path('M-67-7Q0 23 67-7Q54 61 0 62-53 60-67-7Z', colors.rose, colors.ink, 2)}${path('M-59-4Q0 19 59-4L48 21Q0 42-47 20Z', colors.white, colors.ink, 2)}${path('M-30 7V27M-8 12V31M14 12V31M35 6V25', 'none', colors.ink, 1.5)}</g>`;
const planet = (x, y, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})">${circle(0, 0, 25, colors.sand)}<ellipse cx="0" cy="0" rx="46" ry="12" transform="rotate(-25)" fill="none" stroke="${colors.ink}" stroke-width="3"/></g>`;

function sceneKind(cue) {
  const phrase = typeof cue === 'object' && cue ? cue : { cue: String(cue || '') };
  const text = String(phrase.text || '').toLowerCase();
  if (/\bsad\b/.test(text) || phrase.id === 'p02') return 'sad';
  if (/\bfloss\b/.test(text)) return 'floss';
  if (/\bmints\b/.test(text)) return 'mints';
  if (/\bwalk\b/.test(text)) return 'walk';
  if (/\btalk\b/.test(text)) return 'talk';
  if (/\blove\b/.test(text)) return 'love';
  if (/\bwhite\b|\bpearly\b/.test(text)) return 'pearly';
  if (/\bjaw\b/.test(text)) return 'jaw';
  return phrase.cue || 'teeth';
}

/** Decorative SVG: no external assets, IDs, scripts, text, or user HTML. */
export function renderScene(cue = 'teeth') {
  const kind = sceneKind(cue);
  let drawing;
  switch (kind) {
    case 'island': drawing = `${circle(389, 62, 25, colors.sun)}${cloud(90, 58, .65)}${waves()}${path('M94 239Q148 173 250 207 312 228 344 249 207 281 94 239Z', colors.sand, colors.sand, 1)}${path('M252 219Q279 161 263 113', 'none', colors.ink, 7)}${path('M263 121Q223 91 198 119 233 123 263 121M263 121Q286 80 318 102 288 117 263 121M263 121Q287 115 313 147 282 142 263 121M263 121Q247 97 231 90', colors.green, colors.green, 4)}${circle(168, 199, 7, colors.ink)}${path('M168 208V229M168 215L158 220M168 215L179 220M168 229L162 238M168 229L176 237', 'none', colors.ink, 4)}`; break;
    case 'sea': drawing = `${circle(379, 58, 24, colors.sun)}${cloud(107, 61, .75)}${cloud(286, 102, .5)}${waves()}${path('M307 197H373L359 216H320Z', colors.sand, colors.ink, 2)}${path('M340 195V128L369 187H340M338 151L313 185H338', colors.white, colors.ink, 2)}${path('M56 150q13-12 25 0 13-12 25 0', 'none', colors.ink, 2)}`; break;
    case 'sad': drawing = `${cloud(115, 76, .85)}${path('M85 117l-6 14M114 124l-6 14M145 117l-6 14', 'none', colors.seaLine, 3)}${circle(370, 209, 51, colors.sand)}${circle(352, 203, 3, colors.ink)}${circle(385, 203, 3, colors.ink)}${path('M351 231Q369 212 388 231', 'none', colors.ink, 3)}${path('M391 213q-9 12 0 12 8-1 0-12Z', colors.sea, colors.seaLine, 1)}${path('M0 284Q137 249 267 281T480 280V300H0Z', colors.sky, colors.sky, 1)}`; break;
    case 'star': drawing = `${planet(378, 217, 1.2)}${circle(85, 66, 29, colors.sky)}${circle(98, 57, 27, colors.white)}${sparkle(69, 207, 18)}${sparkle(409, 60, 13)}${sparkle(316, 48, 9)}${sparkle(160, 250, 11)}${circle(288, 241, 3, colors.seaLine)}${circle(167, 64, 3, colors.seaLine)}${circle(431, 130, 3, colors.seaLine)}${path('M7 274Q137 238 210 275T480 268', 'none', colors.sky, 4)}`; break;
    case 'tree': drawing = `${path('M373 69L411 136H393L430 195H405L444 250H299L338 195H315L352 136H335Z', colors.green, colors.ink, 2)}${path('M363 250V280H384V250', colors.sand, colors.ink, 2)}${sparkle(373, 55, 15)}${circle(361, 151, 6, colors.rose)}${circle(395, 201, 6, colors.sun)}${circle(340, 223, 6, colors.rose)}${path('M338 178Q373 194 408 178M325 226Q372 244 422 225', 'none', colors.white, 4)}${tooth(99, 239, .64)}${sparkle(93, 76, 12)}`; break;
    case 'brush': drawing = `${tooth(344, 219, 1.13)}<g transform="translate(87 188) rotate(-27)"><rect x="-10" y="-36" width="20" height="124" rx="10" fill="${colors.rose}"/><rect x="-13" y="-81" width="26" height="57" rx="9" fill="${colors.green}"/>${path('M-8-74H25M-8-62H25M-8-50H25M-8-38H25', 'none', colors.white, 5)}</g>${path('M155 232H199L193 284H161Z', colors.sea, colors.ink, 2)}${circle(312, 110, 12, colors.sky)}${circle(358, 80, 7, colors.sky)}${sparkle(402, 134, 14)}`; break;
    case 'floss': drawing = `${tooth(122, 221, .84, false)}${tooth(351, 221, .84, false)}${path('M71 166Q114 106 189 164T362 164Q390 128 419 160', 'none', colors.ink, 3)}<rect x="197" y="219" width="72" height="55" rx="15" fill="${colors.sea}" stroke="${colors.ink}" stroke-width="2"/>${path('M220 233H247M233 219V188Q233 171 250 166', 'none', colors.ink, 2)}${sparkle(93, 85, 13)}${sparkle(392, 84, 11)}`; break;
    case 'mints': drawing = `${path('M313 231C267 223 280 172 324 167 333 204 333 218 313 231Z', colors.green, colors.ink, 2)}${path('M315 228L321 179M303 207L319 202', 'none', colors.ink, 2)}${path('M329 239C320 198 369 186 397 208 382 235 354 252 329 239Z', colors.green, colors.ink, 2)}${path('M333 236L383 212', 'none', colors.ink, 2)}${circle(116, 231, 30, colors.white, colors.ink)}${circle(169, 254, 22, colors.white, colors.ink)}${path('M99 231H133M155 254H183', 'none', colors.sky, 4)}${path('M79 92Q103 73 125 92M351 84Q380 64 408 84', 'none', colors.sky, 4)}`; break;
    case 'strong': drawing = `${tooth(352, 213, 1.1)}${path('M304 215L282 192 266 216 282 233M402 215L422 190 438 215 421 233', 'none', colors.ink, 6)}${path('M80 280V207M81 238Q35 240 36 205 71 202 81 238M82 224Q121 219 122 184 85 187 82 224', colors.green, colors.ink, 2)}${sparkle(380, 78, 15)}${circle(97, 96, 21, colors.sun)}`; break;
    case 'walk': drawing = `${path('M-10 292Q70 206 137 250T278 230Q337 182 399 207T490 189', 'none', colors.sand, 36)}${path('M3 290Q70 206 137 250T278 230Q337 182 399 207T485 189', 'none', colors.white, 2)}<ellipse cx="137" cy="253" rx="9" ry="16" transform="rotate(48 137 253)" fill="${colors.ink}"/><ellipse cx="188" cy="260" rx="9" ry="16" transform="rotate(65 188 260)" fill="${colors.ink}"/>${tooth(376, 155, .67)}${circle(74, 66, 25, colors.sun)}${cloud(366, 61, .55)}`; break;
    case 'talk': drawing = `${circle(100, 236, 43, colors.sand)}${circle(88, 230, 3, colors.ink)}${circle(113, 230, 3, colors.ink)}${path('M87 250Q101 265 115 249', 'none', colors.ink, 3)}${path('M329 73H423Q441 73 441 91V123Q441 139 422 139H378L353 158V139H329Q312 139 312 121V91Q312 73 329 73Z', colors.sky, colors.ink, 2)}${circle(344, 107, 4, colors.ink)}${circle(376, 107, 4, colors.ink)}${circle(408, 107, 4, colors.ink)}${mouth(353, 231, .64)}${sparkle(72, 71, 10)}`; break;
    case 'love': case 'heart': drawing = `${tooth(98, 225, .85)}${tooth(374, 225, .85)}${heart(75, 81, .68)}${heart(405, 82, .78)}${heart(331, 129, .48)}${path('M141 267Q235 288 333 267', 'none', colors.sand, 8)}${sparkle(199, 58, 9)}`; break;
    case 'smile': drawing = `${circle(359, 220, 62, colors.sand)}${circle(339, 207, 3, colors.ink)}${circle(379, 207, 3, colors.ink)}${mouth(359, 229, .59)}${sparkle(419, 154, 13)}${sparkle(70, 70, 15)}${cloud(122, 218, .62)}${path('M42 280Q121 251 193 278', 'none', colors.green, 7)}`; break;
    case 'music': drawing = `${circle(365, 221, 54, colors.sky, colors.ink)}${circle(365, 221, 29, colors.white, colors.ink)}${circle(365, 221, 7, colors.sun)}${path('M86 214V119L146 105V199M87 143L145 129', 'none', colors.ink, 6)}<ellipse cx="73" cy="216" rx="15" ry="10" fill="${colors.green}"/><ellipse cx="132" cy="200" rx="15" ry="10" fill="${colors.green}"/>${sparkle(387, 72, 14)}${path('M197 258Q223 236 242 259', 'none', colors.sand, 7)}`; break;
    case 'happy': drawing = `${circle(382, 69, 27, colors.sun)}${path('M382 25V15M382 113V124M339 69H327M425 69H437M351 38L343 30M412 100L421 108M412 38L421 30', 'none', colors.sun, 4)}${circle(108, 220, 43, colors.sand)}${circle(94, 213, 3, colors.ink)}${circle(122, 213, 3, colors.ink)}${path('M92 230Q108 246 125 230', 'none', colors.ink, 3)}${path('M64 268L45 250M151 268L171 245', 'none', colors.ink, 5)}${sparkle(366, 238, 20)}${sparkle(417, 188, 11)}${cloud(98, 66, .6)}`; break;
    case 'pearly': drawing = `${mouth(347, 217, .95)}${[52, 77, 102, 127, 152].map((x, index) => circle(x, 249 - Math.sin(index) * 13, 13, colors.white, colors.seaLine, 1.5)).join('')}${sparkle(398, 114, 15)}${sparkle(87, 76, 14)}${circle(146, 117, 8, colors.sky)}`; break;
    case 'jaw': drawing = `${mouth(344, 206, 1.08)}${path('M255 207Q260 291 344 291 429 291 432 207', 'none', colors.sand, 14)}${tooth(100, 226, .77, false)}${sparkle(406, 88, 15)}${sparkle(77, 77, 11)}`; break;
    case 'sparkle': drawing = `${tooth(354, 219, 1.05)}${sparkle(291, 151, 19)}${sparkle(416, 158, 13)}${sparkle(91, 75, 17)}${sparkle(113, 238, 21)}${circle(360, 69, 5, colors.sun)}${path('M81 152Q65 175 81 181 98 176 81 152Z', colors.sea, colors.seaLine, 1)}${path('M406 237Q396 254 407 258 418 253 406 237Z', colors.sea, colors.seaLine, 1)}`; break;
    default: drawing = `${tooth(354, 219, 1.1)}${mouth(101, 231, .72)}${sparkle(412, 138, 16)}${sparkle(81, 72, 15)}${circle(367, 65, 24, colors.sun)}${path('M21 289Q132 265 234 285T480 281', 'none', colors.sky, 10)}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="scene-illustration" viewBox="0 0 480 300" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><g opacity=".9">${drawing}</g></svg>`;
}

// WORD_ALIGNMENT_DATA is generated from the supplied, machine-assisted alignment.
// Each row is [song phrase start, song phrase end, [[word start, word end], ...]].
// Zero-length word runs are estimated between neighboring timed anchors and marked
// machine-assisted. Unmatched occurrences reuse a phrase's timing proportions.
const WORD_ALIGNMENT_DATA = {"p01":[[3.5,5.74,[[3.6000000000000005,4.28],[4.28,4.56],[4.56,4.86],[4.86,5.62]]]],"p02":[[6.4,8.72,[[6.64,6.78],[6.78,7.08],[7.08,7.26],[7.26,7.62],[7.62,8.16]]]],"p03":[[9.04,11.72,[[9.22,9.48],[9.48,9.76],[9.76,10.46],[10.46,10.58],[10.58,11.26],[11.26,11.68]]]],"p04":[[11.72,13.2,[[11.98,12],[12,12.14],[12.14,12.58],[12.58,13.04]]]],"p05":[[13.96,15.66,[[14.3,14.46],[14.58,14.82],[14.82,15.12],[15.12,15.5]]]],"p06":[[16.32,18.26,[[16.56,16.88],[16.88,17.16],[17.16,17.4],[17.4,17.66],[17.66,18.14]]]],"p07":[[18.98,20.72,[[19.08,19.42],[19.42,19.76],[19.76,20],[20,20.26],[20.26,20.72]]]],"p08":[[20.72,21.68,[[20.78,21.02],[21.02,21.26],[21.26,21.42],[21.42,21.64]]]],"p09":[[21.68,23.3,[[21.8,21.88],[21.88,22.1],[22.1,22.46],[22.46,22.72],[22.72,23.14]]],[43.1,44.76,[[43.1,43.46],[43.46,43.52],[43.52,43.88],[43.88,44.2],[44.2,44.62]],"machine-assisted"],[53.3,54.86,[[53.34,53.44],[53.44,53.66],[53.66,53.98],[53.98,54.3],[54.3,54.74]]],[108.84,110.54,[[108.92,109.14],[109.14,109.26],[109.26,109.64],[109.64,109.88],[109.88,110.34]]],[110.54,113.04,[[111.44,111.56],[111.56,111.64],[111.64,112.05],[112.05,112.46],[112.46,112.88]],"machine-assisted"]],"p10":[[24.02,26.06,[[24.12,24.4],[24.4,24.64],[24.64,24.96],[24.96,25.3],[25.3,25.8]]],[89.32,91.5,[[89.32,90.06],[90.06,90.3],[90.3,90.6],[90.6,90.92],[90.92,91.38]],"machine-assisted"]],"p11":[[26.4,28.94,[[26.5,26.68],[26.68,27],[27,27.24],[27.24,27.46],[27.46,27.8],[27.8,28.52]]],[92.2,94.7,[[92.32,92.34],[92.34,92.72],[92.72,92.94],[92.94,93.16],[93.16,93.46],[93.46,93.88]]]],"p12":[[29.1,31.12,[[29.2,29.46],[29.46,29.7],[29.7,30.02],[30.02,30.3],[30.3,31.12]]],[94.9,96.94,[[95.02,95.16],[95.16,95.32],[95.32,95.64],[95.64,95.96],[95.96,96.8]]]],"p13":[[31.12,34.08,[[31.54,31.58],[31.58,31.9],[31.9,32.36],[32.36,32.72],[32.72,33.56]]],[96.94,99.1,[[96.94,97.24],[97.24,97.54],[97.54,98.12],[98.12,98.46],[98.46,98.96]],"machine-assisted"]],"p14":[[34.08,36.14,[[34.08,34.5],[34.5,34.72],[34.72,35.04],[35.04,35.4],[35.4,35.72]]],[99.86,101.98,[[99.98,100.16],[100.16,100.36],[100.36,100.68],[100.68,101.04],[101.04,101.8]]]],"p15":[[36.14,38.66,[[36.68,36.76],[36.76,37.1],[37.1,37.36],[37.36,37.74],[37.74,38.54]]],[102.28,104.74,[[102.4,102.46],[102.46,102.82],[102.82,103.02],[103.02,103.5],[103.5,104.3]]]],"p16":[[39.28,40.72,[[39.4,39.52],[39.52,39.7],[39.7,39.88],[39.88,40.12],[40.12,40.36],[40.36,40.6]]],[104.94,106.38,[[105.06,105.22],[105.22,105.38],[105.38,105.56],[105.56,105.82],[105.82,106.08],[106.08,106.26]]]],"p17":[[40.5,43.1,[[40.84,40.86],[40.86,41.1],[41.1,41.3],[41.3,41.52],[41.52,42],[42,42.98]]],[106.38,108.84,[[106.38,106.6],[106.6,106.82],[106.82,107.02],[107.02,107.22],[107.22,107.68],[107.68,108.76]],"machine-assisted"]],"p18":[[44.76,45.74,[[44.76,44.96],[44.96,45.38],[45.38,45.44],[45.44,45.72]],"machine-assisted"],[76.2,77.46,[[76.2,76.56],[76.56,76.78],[76.84,77.08],[77.08,77.42]]]],"p19":[[45.74,47.62,[[45.74,46.16],[46.16,46.28],[46.28,46.5],[46.5,46.72],[46.72,47.42]]]],"p20":[[48.12,49.72,[[48.24,48.54],[48.54,48.78],[48.78,49.02],[49.02,49.48]]]],"p21":[[50.46,52.1,[[50.86,51.24],[51.24,51.9],[51.9,51.96]]]],"p22":[[52.1,53.3,[[52.18,52.2],[52.2,52.46],[52.46,52.84],[52.84,53.3]]]],"p23":[[55.42,57.38,[[55.66,55.96],[55.96,56.2],[56.2,56.64],[56.64,56.86],[56.86,57.22]]]],"p24":[[58.06,59.94,[[58.18,58.22],[58.22,58.56],[58.56,58.84],[58.84,59.16],[59.16,59.8]]]],"p25":[[60.4,62.84,[[60.92,61.04],[61.04,61.26],[61.26,61.66],[61.66,61.86],[61.86,62.22],[62.22,62.72]]]],"p26":[[62.84,64.98,[[62.94,63.1],[63.1,63.25],[63.25,63.4],[63.4,63.72],[63.72,64],[64,64.24],[64.24,64.84]],"machine-assisted"]],"p27":[[65.38,68.2,[[65.47999999999999,66.02],[66.02,66.26],[66.26,66.6],[66.94,66.96],[66.96,67.24],[67.24,68.1]]]],"p28":[[68.2,70.86,[[68.6,68.68],[68.68,68.94],[68.94,69.22],[69.22,69.46],[69.46,70.48]]]],"p29":[[70.86,72.26,[[71,71.1],[71.1,71.3],[71.3,71.46],[71.46,71.64],[71.64,71.94],[71.94,72.18]]]],"p30":[[72.26,74.86,[[72.38,72.42],[72.42,72.72],[72.72,72.9],[72.9,73.72],[73.72,74.74]]]],"p31":[[74.86,76.2,[[74.86,75.16],[75.16,75.48],[75.48,75.8],[75.8,76.2]],"machine-assisted"]],"p32":[[113.46,116.58,[[113.46,113.85],[113.85,114.24],[114.24,114.63],[114.63,115.02],[115.02,116.32]],"machine-assisted"]]};

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Absolute word times for a song occurrence or a rescaled local phrase clip. */
export function wordTimings(phrase, start = phrase?.start, end = phrase?.end) {
  const text = typeof phrase === 'string' ? phrase : phrase?.text || '';
  const words = tokenizeLyric(text).filter(token => token.isWord);
  if (!words.length) return [];
  const rangeStart = Number.isFinite(start) ? start : 0;
  const rangeEnd = Number.isFinite(end) && end > rangeStart ? end : rangeStart + Math.max(1, words.length * .35);
  const duration = rangeEnd - rangeStart;
  const candidates = WORD_ALIGNMENT_DATA[phrase?.id] || [];
  const exact = candidates.find(row => Math.abs(row[0] - rangeStart) < .025 && Math.abs(row[1] - rangeEnd) < .025);
  const canonical = candidates.find(row => Math.abs(row[0] - (phrase?.start ?? row[0])) < .025) || candidates[0];
  const row = exact || canonical;
  const source = row ? exact ? row[3] || 'machine-aligned' : 'rescaled-alignment' : 'estimated';
  const fractions = row ? row[2].map(([a, b]) => [(a - row[0]) / (row[1] - row[0]), (b - row[0]) / (row[1] - row[0])]) : words.map((word, index) => [index / words.length, (index + 1) / words.length]);
  return words.map((word, index) => ({ key: word.key, text: word.text, index, start: rangeStart + clamp(fractions[index]?.[0] ?? index / words.length, 0, 1) * duration, end: rangeStart + clamp(fractions[index]?.[1] ?? (index + 1) / words.length, 0, 1) * duration, source }));
}

/** A seek-safe 0..1 sweep amount for each word, in data-word-index order. */
export function wordProgress(phrase, start, end, time) {
  return wordTimings(phrase, start, end).map(word => Number.isFinite(time) ? clamp((time - word.start) / (word.end - word.start), 0, 1) : 0);
}
