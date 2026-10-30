#!/usr/bin/env python3
"""从游民星空 favicon 生成像素画 SVG 与各尺寸 PNG 图标。纯标准库。

用法: python3 tools/make-logo.py
输入: assets/favicon.ico（16x16 8bpp BMP 格式的 ICO）
输出: icons/logo.svg, icons/icon-16/32/48/128.png, assets/favicon-preview.png
"""
import struct
import zlib
from collections import OrderedDict

SRC = 'assets/favicon.ico'
SVG_OUT = 'icons/logo.svg'
PREVIEW_OUT = 'assets/favicon-preview.png'
PNG_SIZES = [16, 32, 48, 128]


def read_ico_pixels(path):
    data = open(path, 'rb').read()
    reserved, icon_type, count = struct.unpack_from('<HHH', data, 0)
    assert icon_type == 1, 'not an ICO file'
    best = None
    for i in range(count):
        w, h, colors, rsv, planes, bpp, size, offset = struct.unpack_from('<BBBBHHII', data, 6 + i * 16)
        w = w or 256
        h = h or 256
        payload = data[offset:offset + size]
        image = parse_bmp_payload(payload)
        if best is None or image['width'] > best['width']:
            best = image
    assert best is not None, 'no icon entries'
    return best


def parse_bmp_payload(payload):
    header_size, width, height, planes, bpp, compression, image_size = struct.unpack_from('<IiiHHII', payload, 0)
    assert compression == 0, 'compressed icon payload unsupported'
    rows = abs(height) // 2
    top_down = height < 0
    palette = []
    if bpp == 8:
        palette_offset = header_size
        for i in range(256):
            b, g, r, a = payload[palette_offset + i * 4: palette_offset + i * 4 + 4]
            palette.append((r, g, b, 255))
    elif bpp == 32:
        pass
    else:
        raise ValueError('unsupported bpp: %s' % bpp)

    xor_offset = header_size + (256 * 4 if bpp == 8 else 0)
    stride = ((width * bpp + 31) // 32) * 4
    pixels = [[None] * width for _ in range(rows)]
    for y in range(rows):
        src_y = y if top_down else rows - 1 - y
        base = xor_offset + src_y * stride
        for x in range(width):
            if bpp == 8:
                pixels[y][x] = palette[payload[base + x]]
            else:
                b, g, r, a = payload[base + x * 4: base + x * 4 + 4]
                pixels[y][x] = (r, g, b, a or 255)

    mask_offset = xor_offset + rows * stride
    mask_stride = ((width + 31) // 32) * 4
    for y in range(rows):
        src_y = y if top_down else rows - 1 - y
        base = mask_offset + src_y * mask_stride
        for x in range(width):
            bit = (payload[base + x // 8] >> (7 - (x % 8))) & 1
            if bit:
                r, g, b, a = pixels[y][x]
                pixels[y][x] = (r, g, b, 0)
    return {'width': width, 'height': rows, 'pixels': pixels}


def hex_color(rgba):
    r, g, b, a = rgba
    if a == 0:
        return None
    return '#%02x%02x%02x' % (r, g, b)


def build_svg(image):
    width = image['width']
    height = image['height']
    # 按颜色分组，并把连续同色像素合并成一整段，减少 SVG 节点
    rows = []
    for y in range(height):
        row = []
        x = 0
        while x < width:
            color = hex_color(image['pixels'][y][x])
            if color is None:
                x += 1
                continue
            run_start = x
            while x < width and hex_color(image['pixels'][y][x]) == color:
                x += 1
            row.append((color, run_start, x - run_start))
        rows.append(row)

    by_color = OrderedDict()
    for y, runs in enumerate(rows):
        for color, start, length in runs:
            by_color.setdefault(color, []).append((start, y, length))

    lines = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="128" height="128" '
        'shape-rendering="crispEdges" role="img" aria-label="游民星空像素图标">' % (width, height),
        '  <title>游民星空 · 像素图标</title>',
    ]
    for color, rects in by_color.items():
        lines.append('  <g fill="%s">' % color)
        for start, y, length in rects:
            lines.append('    <rect x="%d" y="%d" width="%d" height="1"/>' % (start, y, length))
        lines.append('  </g>')
    lines.append('</svg>')
    return '\n'.join(lines) + '\n'


def write_png(path, image, size):
    width = image['width']
    height = image['height']
    scale = max(1, size // width)
    out_w = width * scale
    out_h = height * scale
    raw = bytearray()
    for y in range(out_h):
        raw.append(0)
        sy = y // scale
        for x in range(out_w):
            sx = x // scale
            r, g, b, a = image['pixels'][sy][sx]
            raw += bytes((r, g, b, a))

    def chunk(tag, payload):
        return (struct.pack('>I', len(payload)) + tag + payload +
                struct.pack('>I', zlib.crc32(tag + payload) & 0xffffffff))

    png = (b'\x89PNG\r\n\x1a\n' +
           chunk(b'IHDR', struct.pack('>IIBBBBB', out_w, out_h, 8, 6, 0, 0, 0)) +
           chunk(b'IDAT', zlib.compress(bytes(raw), 9)) +
           chunk(b'IEND', b''))
    open(path, 'wb').write(png)
    return out_w


def clean_pixels(image):
    """去掉 favicon 上世纪的 1px 灰色斜面边框，统一成红色圆角方块风格。"""
    width = image['width']
    height = image['height']
    pixels = image['pixels']
    red = (255, 0, 0, 255)
    cleaned = []
    for y in range(height):
        row = []
        for x in range(width):
            r, g, b, a = pixels[y][x]
            if y == 0 or x == 0 or y == height - 1 or x == width - 1:
                row.append(red)  # 外圈灰色渐变斜面 -> 纯红
            elif (r, g, b) == (252, 0, 0):
                row.append(red)  # 近似红合并，减少色阶
            else:
                row.append((r, g, b, a))
        cleaned.append(row)
    image = dict(image)
    image['pixels'] = cleaned
    return image


def main():
    image = clean_pixels(read_ico_pixels(SRC))
    svg = build_svg(image)
    open(SVG_OUT, 'w', encoding='utf-8').write(svg)
    print('wrote %s (%d bytes, %dx%d grid)' % (SVG_OUT, len(svg.encode('utf-8')), image['width'], image['height']))
    for size in PNG_SIZES:
        path = 'icons/icon-%d.png' % size
        out = write_png(path, image, size)
        print('wrote %s (%dx%d)' % (path, out, out))
    write_png(PREVIEW_OUT, image, image['width'] * 16)
    print('wrote %s' % PREVIEW_OUT)


if __name__ == '__main__':
    main()
