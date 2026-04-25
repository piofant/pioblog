#!/usr/bin/env python3
"""
Regenerate CV assets from public/cv/cv.pdf:
- public/cv/cv-page-1.png  (rendered page image)
- src/data/cv-links.json   (clickable link rectangles for the overlay)

Usage: python3 scripts/build-cv.py

Requirements: pdftoppm (poppler-utils) + pypdf (pip install pypdf).
Skip silently if cv.pdf is missing — keeps existing assets in place.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / 'public' / 'cv' / 'cv.pdf'
PNG_PREFIX = ROOT / 'public' / 'cv' / 'cv-page'
LINKS = ROOT / 'src' / 'data' / 'cv-links.json'

if not PDF.exists():
    print(f'[build-cv] No CV PDF at {PDF}, skip')
    sys.exit(0)

# 1. PDF → PNG via pdftoppm (200 dpi)
print(f'[build-cv] Rendering {PDF.name} → PNG')
subprocess.run(
    ['pdftoppm', '-r', '200', str(PDF), str(PNG_PREFIX), '-png'],
    check=True,
)

# 2. Extract clickable links via pypdf
import pypdf

reader = pypdf.PdfReader(str(PDF))
page = reader.pages[0]
W = float(page.mediabox.width)
H = float(page.mediabox.height)

links = []
for annot in page.get('/Annots') or []:
    obj = annot.get_object()
    if obj.get('/Subtype') != '/Link':
        continue
    rect = obj.get('/Rect')
    if not rect:
        continue
    A = obj.get('/A')
    if not A:
        continue
    uri = A.get_object().get('/URI')
    if not uri:
        continue
    x1, y1, x2, y2 = [float(v) for v in rect]
    links.append({
        'uri': str(uri),
        'l': round(min(x1, x2) / W * 100, 3),
        't': round((H - max(y1, y2)) / H * 100, 3),
        'w': round(abs(x2 - x1) / W * 100, 3),
        'h': round(abs(y2 - y1) / H * 100, 3),
    })

LINKS.parent.mkdir(parents=True, exist_ok=True)
LINKS.write_text(json.dumps(links, ensure_ascii=False, indent=2) + '\n')
print(f'[build-cv] Extracted {len(links)} links → {LINKS.relative_to(ROOT)}')
