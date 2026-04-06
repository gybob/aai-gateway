#!/bin/bash
set -e
INPUT_JSON="$1"
OUTPUT_DIR="$2"
VOICE="Cherry"
API_URL="https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"

mkdir -p "$OUTPUT_DIR"

# Create TTS version with spaced abbreviations
node -e "
const subs = require('./${INPUT_JSON}');
const tts = subs.map(s => {
  let t = s.text;
  t = t.replace(/MCP/gi, 'M. C. P.');
  t = t.replace(/CLI/gi, 'C. L. I.');
  t = t.replace(/ACP/gi, 'A. C. P.');
  t = t.replace(/AAI/gi, 'A. A. I.');
  t = t.replace(/API/gi, 'A. P. I.');
  t = t.replace(/PPT/gi, 'P. P. T.');
  t = t.replace(/SRT/gi, 'S. R. T.');
  t = t.replace(/-/g, ' ');
  return { slide: s.slide, text: t };
});
tts.forEach(s => process.stdout.write(s.slide + '\t' + s.text + '\n'));
" | while IFS=$'\t' read -r slide text; do
  echo "  Slide ${slide}..."
  ESCAPED=$(echo "$text" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))")
  RESULT=$(curl -s -X POST "$API_URL" \
    -H "Authorization: Bearer $QWEN_API_KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"qwen3-tts-flash\",\"input\":{\"text\":${ESCAPED},\"voice\":\"${VOICE}\",\"language_type\":\"Chinese\"}}")
  URL=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['output']['audio']['url'])" 2>/dev/null)
  if [ -z "$URL" ]; then echo "    ERROR: $RESULT"; exit 1; fi
  curl -s -o "${OUTPUT_DIR}/slide_${slide}.wav" "$URL"
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "${OUTPUT_DIR}/slide_${slide}.wav")
  echo "    -> ${DUR}s"
done
