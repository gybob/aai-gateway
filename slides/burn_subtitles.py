"""
Generate a video with subtitles burned in using Pillow for text rendering.
For each slide, creates a sequence of frames with different subtitle text,
then uses ffmpeg to combine into video segments.
"""
import json
import os
import subprocess
import re
from PIL import Image, ImageDraw, ImageFont

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RENDERED_DIR = os.path.join(BASE_DIR, "rendered")
AUDIO_DIR = os.path.join(BASE_DIR, "audio")
FRAMES_DIR = os.path.join(BASE_DIR, "frames")
PARTS_DIR = os.path.join(BASE_DIR, "video_parts_sub")
SRT_FILE = os.path.join(BASE_DIR, "subtitles.srt")
OUTPUT = os.path.join(BASE_DIR, "aai-gateway-intro.mp4")

FPS = 25
WIDTH, HEIGHT = 1920, 1080

# Font setup
FONT_PATH = "/System/Library/Fonts/PingFang.ttc"
if not os.path.exists(FONT_PATH):
    FONT_PATH = "/System/Library/Fonts/STHeiti Light.ttc"
FONT_SIZE = 32
FONT = ImageFont.truetype(FONT_PATH, FONT_SIZE)

os.makedirs(FRAMES_DIR, exist_ok=True)
os.makedirs(PARTS_DIR, exist_ok=True)


def parse_srt(path):
    """Parse SRT file into list of (start_sec, end_sec, text)"""
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    blocks = re.split(r"\n\n+", content.strip())
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        # Parse time
        time_match = re.match(
            r"(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})",
            lines[1],
        )
        if not time_match:
            continue
        g = time_match.groups()
        start = int(g[0]) * 3600 + int(g[1]) * 60 + int(g[2]) + int(g[3]) / 1000
        end = int(g[4]) * 3600 + int(g[5]) * 60 + int(g[6]) + int(g[7]) / 1000
        text = "\n".join(lines[2:])
        entries.append((start, end, text))
    return entries


def get_audio_duration(wav_path):
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            wav_path,
        ],
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def draw_subtitle(img, text):
    """Draw subtitle text with black outline on bottom of image"""
    draw = ImageDraw.Draw(img)

    # Calculate text position (centered, near bottom but above progress bar)
    bbox = draw.textbbox((0, 0), text, font=FONT)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    x = (WIDTH - text_w) // 2
    y = HEIGHT - 120 - text_h  # Above the progress bar area

    # Draw outline (black border)
    outline_range = 2
    for dx in range(-outline_range, outline_range + 1):
        for dy in range(-outline_range, outline_range + 1):
            if dx == 0 and dy == 0:
                continue
            draw.text((x + dx, y + dy), text, font=FONT, fill=(0, 0, 0))

    # Draw text (white)
    draw.text((x, y), text, font=FONT, fill=(255, 255, 255))
    return img


def main():
    srt_entries = parse_srt(SRT_FILE)
    subs_data = json.load(open(os.path.join(BASE_DIR, "subtitles.json")))

    # Group SRT entries by slide based on cumulative audio durations
    slide_durations = []
    cumulative = 0
    for sub in subs_data:
        wav = os.path.join(AUDIO_DIR, f"slide_{sub['slide']}.wav")
        dur = get_audio_duration(wav)
        slide_durations.append((cumulative, cumulative + dur, sub["slide"]))
        cumulative += dur

    concat_list = []

    for slide_start, slide_end, slide_num in slide_durations:
        print(f"Processing slide {slide_num}...")
        slide_img_path = os.path.join(RENDERED_DIR, f"slide_{slide_num}.png")
        base_img = Image.open(slide_img_path).resize((WIDTH, HEIGHT), Image.LANCZOS)

        slide_dur = slide_end - slide_start
        total_frames = int(slide_dur * FPS)

        # Get SRT entries for this slide
        slide_srt = [
            (max(0, s - slide_start), min(slide_dur, e - slide_start), t)
            for s, e, t in srt_entries
            if e > slide_start and s < slide_end
        ]

        # Create frames directory for this slide
        slide_frames_dir = os.path.join(FRAMES_DIR, f"slide_{slide_num}")
        os.makedirs(slide_frames_dir, exist_ok=True)

        # Generate key frames (only when subtitle changes)
        # Build a mapping: frame_num -> subtitle_text
        frame_subs = {}
        for start, end, text in slide_srt:
            f_start = int(start * FPS)
            f_end = int(end * FPS)
            for f in range(f_start, min(f_end, total_frames)):
                frame_subs[f] = text

        # Generate unique frame images
        prev_text = None
        frame_img_path = None
        frame_files = []

        for f in range(total_frames):
            text = frame_subs.get(f, "")
            if text != prev_text:
                # Create new frame image
                frame_img = base_img.copy()
                if text:
                    draw_subtitle(frame_img, text)
                frame_img_path = os.path.join(
                    slide_frames_dir, f"frame_{f:05d}.png"
                )
                frame_img.save(frame_img_path)
                prev_text = text

            frame_files.append(frame_img_path)

        # Write frame list for ffmpeg
        frame_list_path = os.path.join(slide_frames_dir, "frames.txt")
        with open(frame_list_path, "w") as fl:
            for fp in frame_files:
                fl.write(f"file '{fp}'\n")
                fl.write(f"duration {1/FPS}\n")

        # Create video part using concat demuxer with frames + audio
        part_path = os.path.join(PARTS_DIR, f"part_{slide_num}.mp4")
        wav_path = os.path.join(AUDIO_DIR, f"slide_{slide_num}.wav")

        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                frame_list_path,
                "-i",
                wav_path,
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-shortest",
                part_path,
            ],
            capture_output=True,
        )
        concat_list.append(f"file '{part_path}'")
        print(f"  Part {slide_num} done")

    # Concatenate all parts
    concat_path = os.path.join(BASE_DIR, "concat_subs.txt")
    with open(concat_path, "w") as f:
        f.write("\n".join(concat_list))

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_path,
            "-c",
            "copy",
            OUTPUT,
        ],
        capture_output=True,
    )

    # Report
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            OUTPUT,
        ],
        capture_output=True,
        text=True,
    )
    dur = result.stdout.strip()
    size = os.path.getsize(OUTPUT)
    print(f"\nDone! Output: {OUTPUT}")
    print(f"Duration: {dur}s, Size: {size / 1024 / 1024:.1f}MB")


if __name__ == "__main__":
    main()
