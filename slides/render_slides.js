// Split each slide into individual PPTX files, then use qlmanage to render
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PPTX_FILE = path.join(__dirname, 'aai-gateway-intro.pptx');
const OUT_DIR = path.join(__dirname, 'rendered');
const SPLIT_DIR = path.join(__dirname, 'split_slides');

// Clean up
if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true });
if (fs.existsSync(SPLIT_DIR)) fs.rmSync(SPLIT_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(SPLIT_DIR, { recursive: true });

// Use python-pptx to split slides
const splitScript = `
import sys
from pptx import Presentation
from pptx.util import Emu
import copy

prs = Presentation('${PPTX_FILE}')
slide_width = prs.slide_width
slide_height = prs.slide_height

for i, slide in enumerate(prs.slides):
    # Create a new presentation for each slide
    new_prs = Presentation()
    new_prs.slide_width = slide_width
    new_prs.slide_height = slide_height

    # Add a blank slide
    blank_layout = new_prs.slide_layouts[6]  # blank layout
    new_slide = new_prs.slides.add_slide(blank_layout)

    # Copy background
    if slide.background.fill.type is not None:
        try:
            new_slide.background.fill.solid()
            new_slide.background.fill.fore_color.rgb = slide.background.fill.fore_color.rgb
        except:
            pass

    # Copy all shapes
    import lxml.etree as etree
    for shape in slide.shapes:
        el = copy.deepcopy(shape._element)
        new_slide.shapes._spTree.append(el)

    out_path = '${SPLIT_DIR}/slide_' + str(i+1) + '.pptx'
    new_prs.save(out_path)
    print(f'Split slide {i+1}')
`;

console.log('Splitting slides...');
execSync(`python3 -c ${JSON.stringify(splitScript)}`, { stdio: 'inherit' });

// Use qlmanage to render each single-slide PPTX
console.log('Rendering slides with qlmanage...');
for (let i = 1; i <= 6; i++) {
  const pptxFile = path.join(SPLIT_DIR, `slide_${i}.pptx`);
  const tmpDir = path.join(__dirname, 'tmp_ql');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  fs.mkdirSync(tmpDir);

  execSync(`qlmanage -t -s 1920 -o "${tmpDir}" "${pptxFile}" 2>/dev/null`);

  // Find generated image
  const files = fs.readdirSync(tmpDir);
  const imgFile = files.find(f => f.endsWith('.png'));
  if (imgFile) {
    fs.copyFileSync(path.join(tmpDir, imgFile), path.join(OUT_DIR, `slide_${i}.png`));
    console.log(`  Rendered slide ${i}`);
  } else {
    console.error(`  ERROR: No image for slide ${i}`);
  }
  fs.rmSync(tmpDir, { recursive: true });
}

console.log('All slides rendered to', OUT_DIR);
