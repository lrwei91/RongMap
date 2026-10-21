#!/usr/bin/env python3
"""生成小程序 <map> 组件所需的标记图标（纯标准库，无需 PIL）。

<map> 的 marker.iconPath 是必填项，所以这些图必须真实存在。
图标是简单的几何图形（圆点 + 描边），用程序绘制而不是外部素材。

用法：
    python3 scripts/generate-miniprogram-markers.py

输出到 miniprogram/images/：
    marker.png         默认地点标记（深色）
    marker-active.png  选中地点标记（黄色高亮）
    marker-user.png    当前位置圆点（蓝色）
"""
import os
import struct
import zlib

SS = 4  # 超采样倍率，用于边缘抗锯齿


def rgba(hex_color, alpha=255):
    hex_color = hex_color.lstrip("#")
    return (
        int(hex_color[0:2], 16),
        int(hex_color[2:4], 16),
        int(hex_color[4:6], 16),
        alpha,
    )


def blank(size):
    return [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]


def paint_circle(canvas, cx, cy, radius, fill, stroke=None, stroke_width=0.0):
    """在画布上画一个（可带描边的）实心圆，坐标以超采样像素为单位。"""
    size = len(canvas)
    for y in range(size):
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            dist = ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5
            if radius - stroke_width <= dist <= radius and stroke is not None:
                canvas[y][x] = stroke
            elif dist <= radius - stroke_width:
                canvas[y][x] = fill
            elif dist <= radius and stroke is None:
                canvas[y][x] = fill


def downsample(canvas, factor):
    """把超采样画布缩回目标尺寸，得到带抗锯齿边缘的结果。"""
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


def marker(path, fill_hex, size=48, radius_ratio=0.40):
    canvas = blank(size * SS)
    center = (size * SS) / 2.0
    paint_circle(canvas, center, center, size * SS * radius_ratio,
                 rgba(fill_hex), rgba("#ffffff"), 2.4 * SS)
    write_png(path, downsample(canvas, SS))


def target(path, fill_hex, size=48):
    """当前位置：外圈描边 + 内点，样式区别于方形/圆形地点标记。"""
    canvas = blank(size * SS)
    center = (size * SS) / 2.0
    paint_circle(canvas, center, center, size * SS * 0.34, rgba(fill_hex), rgba("#ffffff"), 2.6 * SS)
    write_png(path, downsample(canvas, SS))


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "miniprogram", "images")
    root = os.path.normpath(root)
    os.makedirs(root, exist_ok=True)

    marker(os.path.join(root, "marker.png"), "#1a1a1a")
    marker(os.path.join(root, "marker-active.png"), "#ffa62b")
    target(os.path.join(root, "marker-user.png"), "#315efb")

    for name in ("marker.png", "marker-active.png", "marker-user.png"):
        full = os.path.join(root, name)
        print("wrote", full, os.path.getsize(full), "bytes")


if __name__ == "__main__":
    main()
