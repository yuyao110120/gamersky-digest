#!/usr/bin/env python3
"""生成占位图标：深色圆角方块 + 三条新闻线（最后一条为强调橙色）。纯标准库。"""
import struct, zlib, os

SS = 4  # 超采样倍数

def rounded_rect_sd(x, y, w, h, r, px, py):
    # 返回点是否在圆角矩形内
    if px < x or px > x + w or py < y or py > y + h:
        return False
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    dx = px - cx
    dy = py - cy
    return dx * dx + dy * dy <= r * r + 0.0001

def make_icon(size, path):
    w = h = size
    sw = w * SS
    sh = h * SS
    bg = (31, 34, 39, 255)
    white = (255, 255, 255, 255)
    orange = (232, 89, 12, 255)
    radius = 0.22 * sw
    bars = [
        (0.26, 0.275, 0.48, 0.085, white),
        (0.26, 0.445, 0.48, 0.085, white),
        (0.26, 0.615, 0.30, 0.085, orange),
    ]
    rows = []
    for py in range(sh):
        row = bytearray()
        for px in range(sw):
            r = g = b = a = 0
            if rounded_rect_sd(0, 0, sw, sh, radius, px, py):
                r, g, b, a = bg
                for bx, by, bw, bh, color in bars:
                    if rounded_rect_sd(bx * sw, by * sh, bw * sw, bh * sh, 0.03 * sw, px, py):
                        r, g, b, a = color
                        break
            row += bytes((r, g, b, a))
        rows.append(row)

    # 4x4 盒式降采样
    out = bytearray()
    for y in range(h):
        out.append(0)
        for x in range(w):
            tr = tg = tb = ta = 0
            for yy in range(SS):
                row = rows[y * SS + yy]
                for xx in range(SS):
                    idx = (x * SS + xx) * 4
                    tr += row[idx]
                    tg += row[idx + 1]
                    tb += row[idx + 2]
                    ta += row[idx + 3]
            n = SS * SS
            out += bytes((tr // n, tg // n, tb // n, ta // n))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
           chunk(b'IDAT', zlib.compress(bytes(out), 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    print('wrote', path, size)

if __name__ == '__main__':
    os.makedirs('icons', exist_ok=True)
    for s in (16, 48, 128):
        make_icon(s, os.path.join('icons', 'icon-%d.png' % s))
