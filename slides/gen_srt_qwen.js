const { execSync } = require('child_process');
const fs = require('fs');

const subs = require('./subtitles.json');

let globalStart = 0;
let srtIndex = 1;
let srtContent = '';

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' +
    String(s).padStart(2, '0') + ',' + String(ms).padStart(3, '0');
}

subs.forEach(sub => {
  const wavFile = `audio_qwen/slide_${sub.slide}.wav`;
  const durStr = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${wavFile}`).toString().trim();
  const totalDur = parseFloat(durStr);

  // Split text into sentences
  const sentences = sub.text.split(/(?<=[。？！])/).filter(s => s.trim());
  const charTotal = sentences.reduce((sum, s) => sum + s.length, 0);

  let offset = globalStart;
  sentences.forEach(sentence => {
    const sentDur = (sentence.length / charTotal) * totalDur;
    const start = offset;

    // Split long sentences into chunks of ~25 chars for readability
    const maxChars = 26;
    const chunks = [];
    let remaining = sentence.trim();
    while (remaining.length > maxChars) {
      let breakAt = maxChars;
      // Find good break points: commas, enumeration marks
      const candidates = [
        remaining.lastIndexOf('，', maxChars),
        remaining.lastIndexOf('、', maxChars),
        remaining.lastIndexOf('；', maxChars),
        remaining.lastIndexOf(' ', maxChars),
      ];
      const best = Math.max(...candidates);
      if (best > maxChars * 0.35) breakAt = best + 1;
      chunks.push(remaining.substring(0, breakAt));
      remaining = remaining.substring(breakAt);
    }
    if (remaining) chunks.push(remaining);

    // Distribute time across chunks proportionally
    const chunkCharTotal = chunks.reduce((s, c) => s + c.length, 0);
    let chunkOffset = start;
    chunks.forEach(chunk => {
      const chunkDur = (chunk.length / chunkCharTotal) * sentDur;
      srtContent += srtIndex + '\n';
      srtContent += formatTime(chunkOffset) + ' --> ' + formatTime(chunkOffset + chunkDur) + '\n';
      srtContent += chunk.trim() + '\n\n';
      srtIndex++;
      chunkOffset += chunkDur;
    });

    offset += sentDur;
  });

  globalStart += totalDur;
});

fs.writeFileSync('subtitles.srt', srtContent);
console.log(`SRT generated: ${srtIndex - 1} entries, total ${formatTime(globalStart)}`);
