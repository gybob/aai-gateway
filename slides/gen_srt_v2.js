/**
 * Improved SRT generator with better sync:
 * - Adds pause gaps between sentences (TTS naturally pauses at sentence boundaries)
 * - Uses shorter subtitle chunks for tighter timing
 * - Accounts for punctuation pauses
 */
const { execSync } = require('child_process');
const fs = require('fs');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}

const INPUT = args['input'] || 'subtitles.json';
const AUDIO_DIR = args['audio-dir'] || 'audio';
const OUTPUT = args['output'] || 'subtitles.srt';
const MAX_CHARS = parseInt(args['max-chars'] || '24', 10);
// Fraction of total duration reserved for inter-sentence pauses
const PAUSE_RATIO = parseFloat(args['pause-ratio'] || '0.08');

const subs = JSON.parse(fs.readFileSync(INPUT, 'utf-8'));

function fmt(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':') + ',' + String(ms).padStart(3, '0');
}

function getDuration(f) {
  return parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).toString().trim());
}

let globalStart = 0;
let srtIndex = 1;
let srtContent = '';

subs.forEach(sub => {
  const wav = `${AUDIO_DIR}/slide_${sub.slide}.wav`;
  const totalDur = getDuration(wav);

  // Split into sentences
  const sentences = sub.text.split(/(?<=[。？！])/).filter(s => s.trim());
  const numSentences = sentences.length;

  // Reserve time for pauses between sentences
  const totalPause = totalDur * PAUSE_RATIO;
  const pausePerGap = numSentences > 1 ? totalPause / (numSentences - 1) : 0;
  const speechDur = totalDur - totalPause;

  // Weight each sentence by character count
  const charTotal = sentences.reduce((sum, s) => sum + s.length, 0);

  let offset = globalStart;

  sentences.forEach((sentence, sentIdx) => {
    const sentDur = (sentence.length / charTotal) * speechDur;

    // Split into display chunks
    const chunks = [];
    let rem = sentence.trim();
    while (rem.length > MAX_CHARS) {
      let b = MAX_CHARS;
      const candidates = [
        rem.lastIndexOf('，', MAX_CHARS),
        rem.lastIndexOf('、', MAX_CHARS),
        rem.lastIndexOf('；', MAX_CHARS),
        rem.lastIndexOf('：', MAX_CHARS),
        rem.lastIndexOf(' ', MAX_CHARS),
      ];
      const best = Math.max(...candidates);
      if (best > MAX_CHARS * 0.35) b = best + 1;
      chunks.push(rem.substring(0, b));
      rem = rem.substring(b);
    }
    if (rem) chunks.push(rem);

    // Distribute time across chunks
    const cc = chunks.reduce((s, c) => s + c.length, 0);
    let co = offset;
    chunks.forEach(chunk => {
      const cd = (chunk.length / cc) * sentDur;
      // Trim a tiny bit off end to prevent subtitle overlap
      const displayEnd = co + cd - 0.05;
      srtContent += srtIndex + '\n';
      srtContent += fmt(co) + ' --> ' + fmt(Math.max(co + 0.1, displayEnd)) + '\n';
      srtContent += chunk.trim() + '\n\n';
      srtIndex++;
      co += cd;
    });

    offset += sentDur;
    // Add inter-sentence pause
    if (sentIdx < numSentences - 1) {
      offset += pausePerGap;
    }
  });

  globalStart += totalDur;
});

fs.writeFileSync(OUTPUT, srtContent);
console.log(`SRT: ${srtIndex - 1} entries, total: ${fmt(globalStart)}`);
console.log(`Output: ${OUTPUT}`);
