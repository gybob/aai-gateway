#!/bin/bash
set -e
cd "$(dirname "$0")"
mkdir -p audio

VOICE="Tingting"
RATE=210

# Extract text from JSON and generate audio for each slide
node -e "
const subs = require('./subtitles.json');
subs.forEach(s => {
  console.log(s.slide + '|||' + s.text);
});
" | while IFS='|||' read -r slide text; do
  echo "Generating audio for slide ${slide}..."
  say -v "$VOICE" -r $RATE "$text" -o "audio/slide_${slide}.aiff"
  # Convert to wav for ffmpeg compatibility
  ffmpeg -y -i "audio/slide_${slide}.aiff" -ar 44100 -ac 1 "audio/slide_${slide}.wav" 2>/dev/null
  echo "  -> audio/slide_${slide}.wav done"
done

echo "All audio files generated."
