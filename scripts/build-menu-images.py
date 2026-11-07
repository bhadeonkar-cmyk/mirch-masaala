#!/usr/bin/env python3
"""Build the web-sized menu images used by the app.

The approved artwork masters (99 PNGs, 1024x1024, ~1 MB each) live on the
`claude/menu-assets` branch under Mirch_Masaala_PNG_Assets/. They are far too
heavy to ship to phones, so this script writes small WebP copies into
./menu-images/ . The app maps menu item IDs to these files in menu-images.js.

Usage (from the repository root, with the masters checked out locally):
    python3 scripts/build-menu-images.py [path/to/Mirch_Masaala_PNG_Assets]

Requires Pillow with WebP support.
"""
import sys
from pathlib import Path
from PIL import Image

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else 'Mirch_Masaala_PNG_Assets')
OUT = Path(__file__).resolve().parent.parent / 'menu-images'
SIZE = 320      # card thumbnails are at most 88 CSS px (~264 px on a 3x phone)
QUALITY = 82

# Four dishes exist in two categories with the same filename. Give each its own slug.
RENAME = {
    '02-papad-mutton-specials/mutton-kharda': 'mutton-kharda-starter',
    '07-mutton-chicken-main/mutton-kharda': 'mutton-kharda-main',
    '03-mutton-chicken-starters/chicken-kharda': 'chicken-kharda-starter',
    '08-chicken-paneer-main/chicken-kharda': 'chicken-kharda-main',
}
# Flagged as a duplicate of 06-thalis-handi/hyderabadi-paya-korma; not used by any menu item.
SKIP = {'07-mutton-chicken-main/hyderabadi-paya-korma-duplicate'}

# The three beverage masters are drawn on a tall canvas with slivers of the neighbouring
# panel at the sides. Crop to the clean panel (x range, in 1024px master pixels), centred on
# the subject, then widen back to a square by repeating each row's edge pixel so the
# panel's own background continues without a seam.
BEVERAGE_CROP = {
    '14-beverages/mineral-water': (261, 821),
    '14-beverages/soft-drink-big': (217, 809),
    '14-beverages/soft-drink-small': (176, 880),
}

# Trim a thin uniform border from every image. A few masters carry a hairline edge mark
# (a few px); every dish keeps at least a 5% margin, so a 2% trim is safe.
INSET = 20


def widen_to_square(im, x0, x1):
    h = im.height
    strip = im.crop((x0, 0, x1, h))
    pad = (h - strip.width) // 2
    canvas = Image.new('RGB', (h, h))
    canvas.paste(strip.crop((0, 0, 1, h)).resize((pad, h)), (0, 0))
    canvas.paste(strip.crop((strip.width - 1, 0, strip.width, h)).resize((h - pad - strip.width, h)),
                 (pad + strip.width, 0))
    canvas.paste(strip, (pad, 0))
    return canvas


def to_square(im, key):
    im = im.convert('RGBA')
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    im = bg.convert('RGB')
    if key in BEVERAGE_CROP:
        im = widen_to_square(im, *BEVERAGE_CROP[key])
    im = im.crop((INSET, INSET, im.width - INSET, im.height - INSET))
    return im.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    if not SRC.is_dir():
        sys.exit(f'Masters not found at {SRC}. Check out claude/menu-assets first.')
    OUT.mkdir(exist_ok=True)
    written = 0
    for path in sorted(SRC.glob('*/*.png')):
        key = f'{path.parent.name}/{path.stem}'
        if key in SKIP:
            continue
        slug = RENAME.get(key, path.stem)
        to_square(Image.open(path), key).save(OUT / f'{slug}.webp', 'WEBP', quality=QUALITY, method=6)
        written += 1
    print(f'Wrote {written} images to {OUT}')


if __name__ == '__main__':
    main()
