#!/usr/bin/env python3
"""Génère les icônes PNG de la PWA (même design que app/icons/icon.svg).

Écrivain PNG en Python pur (stdlib uniquement), rendu supersamplé 2× :
    python3 tools/make_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / 'app' / 'icons'

TOP = (18, 58, 92)      # #123a5c
BOTTOM = (15, 116, 144)  # #0f7490
WAVES = [(0.50, 0.90), (0.63, 0.55), (0.76, 0.30)]  # (position y, opacité)
BUBBLES = [(0.72, 0.24, 0.075, 0.9), (0.83, 0.14, 0.045, 0.7), (0.66, 0.11, 0.028, 0.5)]


def write_png(path, size, rows):
    def chunk(tag, data):
        block = struct.pack('>I', len(data)) + tag + data
        return block + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # RGBA 8 bits
    raw = b''.join(b'\x00' + bytes(row) for row in rows)
    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', header)
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )
    path.write_bytes(png)
    print(f'  {path.name} ({size}×{size})')


def render(size, rounded):
    ss = 2  # facteur de supersampling
    S = size * ss
    amp = 0.048 * S
    thick = 0.030 * S
    corner = 0.21 * S
    half = S / 2

    big_rows = []
    for y in range(S):
        row = []
        t = y / S
        base = [TOP[i] + (BOTTOM[i] - TOP[i]) * t for i in range(3)]
        for x in range(S):
            r, g, b = base
            for wy, wa in WAVES:
                yc = wy * S + amp * math.sin(2 * math.pi * 2.2 * x / S + wy * 9)
                d = abs(y - yc)
                if d < thick:
                    a = wa * min(1.0, (thick - d) / (0.3 * thick))
                    r += (255 - r) * a
                    g += (255 - g) * a
                    b += (255 - b) * a
            for bx, by, br, ba in BUBBLES:
                ring = 0.013 * S
                dd = abs(math.hypot(x - bx * S, y - by * S) - br * S)
                if dd < ring:
                    a = ba * min(1.0, (ring - dd) / (0.4 * ring))
                    r += (255 - r) * a
                    g += (255 - g) * a
                    b += (255 - b) * a
            if rounded:
                dx = max(abs(x + 0.5 - half) - (half - corner), 0.0)
                dy = max(abs(y + 0.5 - half) - (half - corner), 0.0)
                dist = math.hypot(dx, dy) - corner
                alpha = int(max(0.0, min(1.0, 0.5 - dist)) * 255)
            else:
                alpha = 255
            row.extend((int(r), int(g), int(b), alpha))
        big_rows.append(row)

    # Réduction 2×2 par moyenne.
    rows = []
    for y in range(size):
        row = []
        r0, r1 = big_rows[2 * y], big_rows[2 * y + 1]
        for x in range(size):
            i = 8 * x
            for c in range(4):
                row.append((r0[i + c] + r0[i + 4 + c] + r1[i + c] + r1[i + 4 + c]) // 4)
        rows.append(row)
    return rows


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print('Génération des icônes…')
    write_png(OUT_DIR / 'icon-512.png', 512, render(512, rounded=True))
    write_png(OUT_DIR / 'icon-192.png', 192, render(192, rounded=True))
    write_png(OUT_DIR / 'icon-maskable-512.png', 512, render(512, rounded=False))
    write_png(OUT_DIR / 'apple-touch-icon.png', 180, render(180, rounded=False))


if __name__ == '__main__':
    main()
