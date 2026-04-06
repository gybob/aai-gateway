#!/bin/bash
set -e
cd "$(dirname "$0")"

PPTX="aai-gateway-intro.pptx"
SLIDE_DIR="rendered"
AUDIO_DIR="audio"
OUTPUT="aai-gateway-intro.mp4"
SRT_FILE="subtitles.srt"

# ── Step 1: Render PPTX to PNGs ──
echo "=== Step 1: Rendering PPTX to PNGs ==="
SOFFICE="/Applications/LibreOffice.app/Contents/MacOS/soffice"
if [ ! -f "$SOFFICE" ]; then
  SOFFICE="soffice"
fi

rm -rf "$SLIDE_DIR" pdf_tmp
mkdir -p pdf_tmp "$SLIDE_DIR"

# Convert PPTX -> PDF
"$SOFFICE" --headless --convert-to pdf --outdir pdf_tmp "$PPTX" 2>/dev/null
PDF_FILE="pdf_tmp/$(basename "$PPTX" .pptx).pdf"

if [ ! -f "$PDF_FILE" ]; then
  echo "ERROR: PDF conversion failed"
  exit 1
fi

# Get total page count
PAGES=$(python3 -c "
from pdf2image import pdfinfo_from_path
info = pdfinfo_from_path('$PDF_FILE')
print(info['Pages'])
")
echo "PDF has $PAGES pages"

# Convert PDF -> PNGs (only slides 1-6 for video)
python3 -c "
from pdf2image import convert_from_path
images = convert_from_path('$PDF_FILE', dpi=200)
for i, img in enumerate(images[:6]):
    img.save(f'$SLIDE_DIR/slide_{i+1}.png', 'PNG')
    print(f'  Rendered slide {i+1}')
"

echo "=== Step 2: Generating SRT subtitles ==="
# Generate SRT file with per-sentence timing from audio durations
node -e "
const subs = require('./subtitles.json');
const { execSync } = require('child_process');

let globalStart = 0;
let srtIndex = 1;
let srtContent = '';

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') + ',' + String(ms).padStart(3,'0');
}

subs.forEach(sub => {
  const wavFile = 'audio/slide_' + sub.slide + '.wav';
  const durStr = execSync('ffprobe -v error -show_entries format=duration -of csv=p=0 ' + wavFile).toString().trim();
  const totalDur = parseFloat(durStr);

  // Split text into sentences for subtitle display
  const sentences = sub.text.split(/(?<=[。？！])/).filter(s => s.trim());
  const charTotal = sentences.reduce((sum, s) => sum + s.length, 0);

  let offset = globalStart;
  sentences.forEach(sentence => {
    const sentDur = (sentence.length / charTotal) * totalDur;
    const start = offset;
    const end = offset + sentDur;

    // Split long sentences into chunks of ~25 chars for display
    const maxChars = 28;
    const chunks = [];
    let remaining = sentence.trim();
    while (remaining.length > maxChars) {
      // Find a good break point
      let breakAt = maxChars;
      const comma = remaining.lastIndexOf('，', maxChars);
      const comma2 = remaining.lastIndexOf('、', maxChars);
      const best = Math.max(comma, comma2);
      if (best > maxChars * 0.4) breakAt = best + 1;
      chunks.push(remaining.substring(0, breakAt));
      remaining = remaining.substring(breakAt);
    }
    if (remaining) chunks.push(remaining);

    // Distribute time across chunks
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

    offset = end;
  });

  globalStart += totalDur;
});

require('fs').writeFileSync('$SRT_FILE', srtContent);
console.log('SRT generated with ' + (srtIndex-1) + ' entries');
"

echo "=== Step 3: Building video ==="

# Create concat file: each slide image held for its audio duration
CONCAT_FILE="concat_list.txt"
rm -f "$CONCAT_FILE"

# Build individual slide videos, then concatenate
mkdir -p video_parts

for i in 1 2 3 4 5 6; do
  IMG="$SLIDE_DIR/slide_${i}.png"
  WAV="$AUDIO_DIR/slide_${i}.wav"
  PART="video_parts/part_${i}.mp4"

  if [ ! -f "$IMG" ] || [ ! -f "$WAV" ]; then
    echo "ERROR: Missing slide_${i}.png or slide_${i}.wav"
    exit 1
  fi

  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WAV")

  # Create video segment: static image + audio
  ffmpeg -y -loop 1 -i "$IMG" -i "$WAV" \
    -c:v libx264 -tune stillimage -pix_fmt yuv420p \
    -c:a aac -b:a 192k \
    -t "$DUR" \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:white" \
    "$PART" 2>/dev/null

  echo "file '$PART'" >> "$CONCAT_FILE"
  echo "  Part $i done (${DUR}s)"
done

# Concatenate all parts
ffmpeg -y -f concat -safe 0 -i "$CONCAT_FILE" -c copy "no_subs_${OUTPUT}" 2>/dev/null
echo "  Video without subtitles ready"

# Burn in subtitles
ffmpeg -y -i "no_subs_${OUTPUT}" \
  -vf "subtitles=${SRT_FILE}:force_style='FontName=PingFang SC,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2,MarginV=60'" \
  -c:v libx264 -crf 20 -preset medium \
  -c:a copy \
  "$OUTPUT" 2>/dev/null

echo ""
echo "=== Done! ==="
echo "Output: $(pwd)/$OUTPUT"
TOTAL_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUTPUT")
echo "Duration: ${TOTAL_DUR}s"
