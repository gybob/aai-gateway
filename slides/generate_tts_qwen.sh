#!/bin/bash
set -e
cd "$(dirname "$0")"
mkdir -p audio_qwen

VOICE="Ethan"
API_URL="https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"

# Read each slide text from subtitles.json and call qwen-tts
node -e "
const subs = require('./subtitles.json');
subs.forEach(s => {
  // Output slide number and text, separated by a null byte
  process.stdout.write(s.slide + '\t' + s.text + '\n');
});
" | while IFS=$'\t' read -r slide text; do
  echo "Generating TTS for slide ${slide}..."

  # Escape text for JSON
  ESCAPED_TEXT=$(echo "$text" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))")

  # Call qwen-tts API
  RESULT=$(curl -s -X POST "$API_URL" \
    -H "Authorization: Bearer $QWEN_API_KEY" \
    -H 'Content-Type: application/json' \
    -d "{
      \"model\": \"qwen3-tts-flash\",
      \"input\": {
        \"text\": ${ESCAPED_TEXT},
        \"voice\": \"${VOICE}\",
        \"language_type\": \"Chinese\"
      }
    }")

  # Extract audio URL
  AUDIO_URL=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['output']['audio']['url'])")

  if [ -z "$AUDIO_URL" ] || [ "$AUDIO_URL" = "None" ]; then
    echo "  ERROR: No audio URL returned for slide ${slide}"
    echo "  Response: $RESULT"
    exit 1
  fi

  # Download audio
  curl -s -o "audio_qwen/slide_${slide}.wav" "$AUDIO_URL"

  # Get duration
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "audio_qwen/slide_${slide}.wav")
  echo "  -> audio_qwen/slide_${slide}.wav done (${DUR}s)"
done

echo ""
echo "All audio files generated with Qwen TTS (voice: ${VOICE})"
echo "Files:"
for f in audio_qwen/slide_*.wav; do
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  echo "  $(basename $f): ${DUR}s"
done
