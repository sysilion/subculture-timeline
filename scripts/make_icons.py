"""favicon.svg와 같은 그림을 PNG로 굽는다 (PIL·rsvg 없이).
   4x 슈퍼샘플링 후 박스 필터 축소로 안티에일리어싱을 낸다."""
import zlib, struct, sys

SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 180
OUT  = sys.argv[2] if len(sys.argv) > 2 else 'assets/apple-touch-icon.png'
SS   = 4
N    = SIZE * SS
K    = N / 64.0   # SVG 좌표계(64) → 슈퍼샘플 픽셀

BG   = (0x12, 0x14, 0x1c)
BARS = [  # x, y, w, h, rgb  (SVG 좌표계)
    (8,   14.0, 34.0, 9,  (0x5c, 0x7c, 0xfa)),
    (18,  27.5, 38.0, 9,  (0x57, 0xb3, 0x7a)),
    (8,   41.0, 26.0, 9,  (0xe8, 0x42, 0x6a)),
    (44,   8.0,  2.5, 48, (0xf4, 0x43, 0x36)),
]

def inside(px, py, x, y, w, h, r):
    """라운드 사각형 내부 판정 — 사각형 안쪽으로 클램프한 점까지 거리가 r 이하인가."""
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r

buf = [None] * N
for j in range(N):
    sy = (j + 0.5) / K
    row = [(0, 0, 0, 0)] * N
    for i in range(N):
        sx = (i + 0.5) / K
        if not inside(sx, sy, 0, 0, 64, 64, 14):
            continue
        col = BG
        for bx, by, bw, bh, rgb in BARS:
            if inside(sx, sy, bx, by, bw, bh, min(bw, bh) / 2):
                col = rgb
        row[i] = col + (255,)
    buf[j] = row

raw = bytearray()
for y in range(SIZE):
    raw.append(0)  # PNG filter type 0
    rows = buf[y * SS:(y + 1) * SS]
    for x in range(SIZE):
        r = g = b = a = 0
        for row in rows:
            for dx in range(SS):
                pr, pg, pb, pa = row[x * SS + dx]
                r += pr * pa; g += pg * pa; b += pb * pa; a += pa
        n = SS * SS
        raw += bytes((r // a, g // a, b // a, a // n)) if a else b'\0\0\0\0'

def chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
       + chunk(b'IEND', b''))
open(OUT, 'wb').write(png)
print(OUT, SIZE, len(png), 'bytes')
