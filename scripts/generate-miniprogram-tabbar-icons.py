#!/usr/bin/env python3
"""生成小程序底部 tabBar 图标（纯标准库绘制，无需 PIL）。

原生 tabBar 只接受图片，不能用 WXSS / SVG 画图标，所以这些图必须真实存在。
选中态用两重信号表达：颜色（灰 → 墨）+ 形态（描边空心 → 实心）。
只改颜色不够——原来的选中色 #1a1a1a 与未选中色 #5f5e5a 都是深灰，在小尺寸下几乎看不出差别。

图标输出 81x81（微信建议值）。几何坐标统一写在 81 单位制里，输出时按目标尺寸缩放。

用法：
    python3 scripts/generate-miniprogram-tabbar-icons.py

输出到 miniprogram/images/tabbar/：
    map.png         / map-active.png         地图
    locations.png   / locations-active.png   地点
    mine.png        / mine-active.png        我的

同时把一张对照预览图写到 /tmp/rongmap-tabbar-preview.png，供肉眼核对（非交付物）。
"""
import os
import struct
import zlib

CANVAS = 81.0   # 几何坐标系边长；与图标输出边长 1:1
STROKE = 4.6    # 描边态的线宽
HALF = STROKE / 2.0
INK = "#1a1a1a"   # 选中态：--ink
IDLE = "#8a8a86"  # 未选中态：比 --muted 更浅，与墨色拉开差距

SS = 4  # 超采样倍率，用于边缘抗锯齿


# ---------- 几何基元（坐标均为 81 单位制）----------

def rgba(hex_color):
    color = hex_color.lstrip("#")
    return (int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16), 255)


def union(*shapes):
    def inside(x, y):
        for shape in shapes:
            if shape(x, y):
                return True
        return False
    return inside


def subtract(base, *holes):
    def inside(x, y):
        if not base(x, y):
            return False
        for hole in holes:
            if hole(x, y):
                return False
        return True
    return inside


def circle(cx, cy, radius):
    def inside(x, y):
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius
    return inside


def ring(cx, cy, radius_outer, radius_inner):
    return subtract(circle(cx, cy, radius_outer), circle(cx, cy, radius_inner))


def rounded_rect(x0, y0, x1, y1, radius):
    def inside(x, y):
        if x < x0 or x > x1 or y < y0 or y > y1:
            return False
        ax = x0 + radius if x < x0 + radius else (x1 - radius if x > x1 - radius else x)
        ay = y0 + radius if y < y0 + radius else (y1 - radius if y > y1 - radius else y)
        return (x - ax) ** 2 + (y - ay) ** 2 <= radius * radius
    return inside


def segment(ax, ay, bx, by, half=HALF):
    """带圆头的粗线段。描边态由它拼出，圆头天然给出圆角与平顺接缝。"""
    def inside(x, y):
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        t = 0.0 if length2 == 0 else ((x - ax) * dx + (y - ay) * dy) / length2
        if t < 0.0:
            t = 0.0
        elif t > 1.0:
            t = 1.0
        px, py = ax + t * dx, ay + t * dy
        return (x - px) ** 2 + (y - py) ** 2 <= half * half
    return inside


def cone(cx, base_y, half_width, apex_y):
    """底宽顶尖的锥形，作地图针的针身。"""
    def inside(x, y):
        if y < base_y or y > apex_y:
            return False
        width = half_width * (apex_y - y) / (apex_y - base_y)
        return abs(x - cx) <= width
    return inside


def above(shape, limit_y):
    return lambda x, y: y <= limit_y and shape(x, y)


# ---------- 三个图标 ----------
# 三者统一占据 y 约 15~66、x 以 40.5 居中，保证图标之间视觉重量一致。

def icon_map(active):
    """地图：定位针。"""
    cx, cy, radius = 40.5, 30.5, 16.0
    apex_y = 64.0
    if active:
        body = union(circle(cx, cy, radius), cone(cx, cy, radius - 3.5, apex_y))
        return subtract(body, circle(cx, cy, 7.0))
    # 描边态：圆环 + 由切点到针尖的两条粗线，针身成 V 形
    tangent_dx, tangent_y = 7.63, 44.56
    return union(
        ring(cx, cy, radius, radius - STROKE),
        segment(cx - tangent_dx, tangent_y, cx, apex_y),
        segment(cx + tangent_dx, tangent_y, cx, apex_y),
    )


def icon_locations(active):
    """地点：书签。"""
    x0, x1, y0, y1 = 23.5, 57.5, 16.0, 65.0
    apex_y, notch_half = 46.0, 12.0
    cx = (x0 + x1) / 2.0

    def notch(x, y):
        if y < apex_y:
            return False
        return abs(x - cx) <= notch_half * (y - apex_y) / (y1 - apex_y)

    if active:
        return subtract(rounded_rect(x0, y0, x1, y1, 4.0), notch)

    # 描边态：四条圆头粗线（左腿 / 右腿 / 顶边 / V 形底）。
    # V 的两条线取实心态斜边的等距内移线，保证两个形态的开口角一致。
    length = (notch_half ** 2 + (y1 - apex_y) ** 2) ** 0.5
    unit_dx = notch_half / length
    unit_dy = (y1 - apex_y) / length
    shift_x = unit_dy * HALF
    shift_y = -unit_dx * HALF
    # 下端点沿斜边回退到「圆头底边正好压在 y1 上」的位置
    back = (HALF + shift_y) / unit_dy
    outer_x = cx + notch_half + shift_x - back * unit_dx
    outer_y = y1 + shift_y - back * unit_dy
    apex_tip_y = apex_y - HALF / unit_dx
    return union(
        segment(x0 + HALF, y0 + HALF, x0 + HALF, y1 - HALF),
        segment(x1 - HALF, y0 + HALF, x1 - HALF, y1 - HALF),
        segment(x0 + HALF, y0 + HALF, x1 - HALF, y0 + HALF),
        segment(outer_x, outer_y, cx, apex_tip_y),
        segment(2 * cx - outer_x, outer_y, cx, apex_tip_y),
    )


def icon_mine(active):
    """我的：人像。"""
    cx = 40.5
    head_cy, head_r = 26.5, 11.0
    body_cy, body_r = 63.0, 21.5
    if active:
        return union(
            circle(cx, head_cy, head_r),
            above(circle(cx, body_cy, body_r), body_cy),
        )
    bust = union(
        above(ring(cx, body_cy, body_r, body_r - STROKE), body_cy),
        segment(cx - body_r + HALF, body_cy, cx + body_r - HALF, body_cy, HALF),
    )
    return union(ring(cx, head_cy, head_r, head_r - STROKE), bust)


ICONS = (
    ("map", icon_map),
    ("locations", icon_locations),
    ("mine", icon_mine),
)


# ---------- 光栅化与 PNG 输出 ----------

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


def rasterize(shape, color, size, ss=SS):
    """输出 size×size 的 RGBA 像素；形状坐标仍是 81 单位制，按 size 缩放采样。"""
    scale = CANVAS / size
    total = ss * ss
    coverage = [[0] * size for _ in range(size)]
    for j in range(size * ss):
        y = (j + 0.5) * scale / ss
        target_row = coverage[j // ss]
        for i in range(size * ss):
            x = (i + 0.5) * scale / ss
            if shape(x, y):
                target_row[i // ss] += 1

    r, g, b, _ = rgba(color)
    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            hits = coverage[y][x]
            if hits == 0:
                row.append((0, 0, 0, 0))
            else:
                row.append((r, g, b, (hits * 255 + total // 2) // total))
        pixels.append(row)
    return pixels


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
    """对照图：上一行放大看形状，下一行按真机 @2x 实际尺寸看粗细。"""
    big, small, gap, pad = 162, 54, 16, 16
    width = pad * 2 + len(entries) * big + (len(entries) - 1) * gap
    height = pad * 2 + big + gap + small
    sheet = [[(255, 255, 255, 255) for _ in range(width)] for _ in range(height)]
    for index, (_, shape, color) in enumerate(entries):
        left = pad + index * (big + gap)
        blit(sheet, rasterize(shape, color, big), left, pad)
        blit(sheet, rasterize(shape, color, small), left, pad + big + gap)
    return sheet


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    target_dir = os.path.normpath(
        os.path.join(script_dir, "..", "miniprogram", "images", "tabbar")
    )
    os.makedirs(target_dir, exist_ok=True)

    written = []
    for name, builder in ICONS:
        for suffix, color, active in (("", IDLE, False), ("-active", INK, True)):
            path = os.path.join(target_dir, name + suffix + ".png")
            pixels = rasterize(builder(active), color, 81)
            # 硬门禁：既不能空图，也不能顶到画布边缘（会被 tabBar 裁掉）
            alpha = [px[3] for row in pixels for px in row]
            assert max(alpha) == 255, "%s 没有实心像素" % path
            assert min(alpha) == 0, "%s 铺满画布、四周缺留白" % path
            for edge in (0, len(pixels) - 1):
                assert max(pixels[edge][x][3] for x in range(len(pixels))) == 0, \
                    "%s 顶部或底部被画满" % path
            write_png(path, pixels)
            written.append(path)

    preview_path = "/tmp/rongmap-tabbar-preview.png"
    write_png(preview_path, build_preview(
        [(name, builder(active), color)
         for name, builder in ICONS
         for active, color in ((False, IDLE), (True, INK))],
    ))

    for path in written:
        print("wrote", path, os.path.getsize(path), "bytes")
    print("preview", preview_path)


if __name__ == "__main__":
    main()
