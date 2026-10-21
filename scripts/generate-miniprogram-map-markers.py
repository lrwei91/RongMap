#!/usr/bin/env python3
"""生成小程序 <map> 的收藏地点标记（纯标准库绘制，无需 PIL）。

优化点（相对原来的一套黑白标记）：
1. 按分类着色 —— 三个分类各有一种核心色，取自项目既有的分类色系（餐饮=黄、
   景点=绿、日咖夜酒=蓝），地图上一眼能看出这一片是哪一类。
2. 保留白色外圈 —— 地图底图深浅不定，外圈白色让标记在任何底图上都能立住。
3. 选中态换成「墨色实心 + 白色圆心」——和底栏、卡片一样，实心代表选中，
   而且比原来的琥珀色更贴项目配色；称呼气泡仍然只给选中态，避免整屏气泡。
4. 去掉原来自带的白底分类字块 —— 31 个地点就有 31 个白框，是地图上最吵的东西。

用法：
    python3 scripts/generate-miniprogram-map-markers.py

输出到 miniprogram/images/markers/：
    food.png / food-active.png
    spot.png / spot-active.png
    cafe_bar.png / cafe_bar-active.png

对照预览图写到 /tmp/rongmap-marker-preview.png（非交付物）。
"""
import os
import struct
import zlib

CANVAS = 96      # 几何坐标系边长
SS = 4           # 超采样倍率，用于边缘抗锯齿
OUTER = 44.0     # 白色外圈半径
HALO = 5.0       # 白色外圈宽度
RING = 7.0       # 墨色描边宽度
CORE = OUTER - HALO - RING   # 核心（分类色）半径 = 32
DOT = 12.0       # 选中态中心的白色圆点半径（留小一点，读起来是「实心+高光」而不是空心环）

INK = "#1a1a1a"
HALO_COLOR = "#ffffff"

# 与 app.wxss 里 .category-square--* 同一色系，但取更浓的一档：
# 地图底图本身有颜色，category-square 那种近乎白的淡色在地图上会糊掉。
CATEGORY_FILL = {
    "food": "#ffe28a",      # --yellow
    "spot": "#b6dcc6",      # --success 的中间调
    "cafe_bar": "#bcc9f2",  # --info 的中间调
}


def rgba(hex_color):
    color = hex_color.lstrip("#")
    return (int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16), 255)


def blank(size):
    return [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]


def paint_disc(canvas, cx, cy, radius, color):
    """把半径 radius 的实心圆刷到超采样画布上（后画的盖住先画的）。"""
    size = len(canvas)
    r2 = radius * radius
    top = max(0, int(cy - radius) - 1)
    bottom = min(size, int(cy + radius) + 2)
    left = max(0, int(cx - radius) - 1)
    right = min(size, int(cx + radius) + 2)
    for y in range(top, bottom):
        dy = y + 0.5 - cy
        for x in range(left, right):
            dx = x + 0.5 - cx
            if dx * dx + dy * dy <= r2:
                canvas[y][x] = color


def downsample(canvas, factor):
    size = len(canvas) // factor
    out = []
    for y in range(size):
        row = []
        for x in range(size):
            r = g = b = a = 0
            for dy in range(factor):
                for dx in range(factor):
                    pr, pg, pb, pa = canvas[y * factor + dy][x * factor + dx]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            count = factor * factor
            if a == 0:
                row.append((0, 0, 0, 0))
            else:
                row.append((r // a, g // a, b // a, a // count))
        out.append(row)
    return out


def write_png(path, pixels):
    height = len(pixels)
    width = len(pixels[0])
    raw = b""
    for row in pixels:
        raw += b"\x00" + b"".join(struct.pack("BBBB", *px) for px in row)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def marker_layers(category, active):
    """由外到内的图层：白色外圈 → 墨色描边 → 核心。"""
    if active:
        return [(OUTER, HALO_COLOR), (OUTER - HALO, INK), (DOT, HALO_COLOR)]
    return [(OUTER, HALO_COLOR), (OUTER - HALO, INK), (CORE, CATEGORY_FILL[category])]


def rasterize(layers, size, ss=SS):
    """按目标边长输出 size×size 的 RGBA 像素（几何仍是 CANVAS 坐标制）。"""
    scale = CANVAS / float(size)
    canvas = blank(size * ss)
    center = size * ss / 2.0
    for radius, color in layers:
        paint_disc(canvas, center, center, radius / scale * ss, rgba(color))
    return downsample(canvas, ss)


def blit(target, source, left, top):
    for dy, row in enumerate(source):
        for dx, (r, g, b, a) in enumerate(row):
            if a == 0:
                continue
            dst = target[top + dy][left + dx]
            if a == 255:
                target[top + dy][left + dx] = (r, g, b, 255)
                continue
            keep = 255 - a
            target[top + dy][left + dx] = (
                (r * a + dst[0] * keep) // 255,
                (g * a + dst[1] * keep) // 255,
                (b * a + dst[2] * keep) // 255,
                255,
            )


def build_preview(entries):
    """对照图：上一行放大看结构，下一行按真机尺寸看效果，底图用浅灰模拟地图。"""
    big, gap, pad, row_gap = 96, 20, 20, 24
    sizes = [28, 36]
    width = pad * 2 + len(entries) * big + (len(entries) - 1) * gap
    small_row = pad + big + row_gap
    height = small_row + max(sizes) + pad
    sheet = [[(236, 239, 241, 255) for _ in range(width)] for _ in range(height)]
    for index, (_, layers, _) in enumerate(entries):
        left = pad + index * (big + gap)
        blit(sheet, rasterize(layers, big), left, pad)
    # 第二行：普通态按 28px、选中态按 36px，与 map-canvas 里的实际尺寸一致
    left = pad
    for index, (name, layers, size) in enumerate(entries):
        blit(sheet, rasterize(layers, size), left, small_row + (max(sizes) - size))
        left += big + gap
    return sheet


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    target_dir = os.path.normpath(
        os.path.join(script_dir, "..", "miniprogram", "images", "markers")
    )
    os.makedirs(target_dir, exist_ok=True)

    written = []
    for category in sorted(CATEGORY_FILL):
        for suffix, active in (("", False), ("-active", True)):
            path = os.path.join(target_dir, category + suffix + ".png")
            pixels = rasterize(marker_layers(category, active), 96)
            # 硬门禁：不能是空图，四周必须留白（标记会被地图按尺寸缩放）
            alpha = [px[3] for row in pixels for px in row]
            assert max(alpha) == 255, "%s 没有实心像素" % path
            for corner in ((0, 0), (0, 95), (95, 0), (95, 95)):
                assert pixels[corner[0]][corner[1]][3] == 0, "%s 四角未留白" % path
            write_png(path, pixels)
            written.append(path)

    entries = []
    for category in sorted(CATEGORY_FILL):
        entries.append((category, marker_layers(category, False), 28))
        entries.append((category + "-active", marker_layers(category, True), 36))
    preview_path = "/tmp/rongmap-marker-preview.png"
    write_png(preview_path, build_preview(entries))

    for path in written:
        print("wrote", path, os.path.getsize(path), "bytes")
    print("preview", preview_path)


if __name__ == "__main__":
    main()
