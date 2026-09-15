# -*- coding: utf-8 -*-
"""
make-icon.py —— 用纯标准库生成应用图标 build/icon.ico

图形：Layui 主绿圆角方块 + 白色时钟（指针指向 10 点 10 分）
不依赖 Pillow / cairo，直接手写 PNG + ICO 容器。
"""

import math
import os
import struct
import zlib

# ----------------------------- 图形参数（归一化 0..1，y 轴向下） -----------------------------

C_GREEN_TOP = (28, 201, 139)     # #1cc98b
C_GREEN_BOTTOM = (16, 168, 106)  # #10a86a
C_WHITE = (255, 255, 255)

RADIUS = 0.225        # 圆角半径
CX, CY = 0.5, 0.525   # 表盘中心
R_OUT = 0.295         # 表盘外半径
RING_W = 0.058        # 表盘环宽
HAND_W = 0.052        # 指针宽度
HOUR_LEN = 0.135      # 时针长度
MIN_LEN = 0.185       # 分针长度
DOT_R = 0.036         # 中心圆点


def _mix(a, b, t):
    return a + (b - a) * t


def _in_round_rect(x, y, r):
    """点是否在 [0,1]x[0,1]、圆角半径 r 的圆角矩形内"""
    if x < 0 or x > 1 or y < 0 or y > 1:
        return False
    dx = max(r - x, x - (1 - r), 0.0)
    dy = max(r - y, y - (1 - r), 0.0)
    return dx * dx + dy * dy <= r * r


def _dist(x0, y0, x1, y1):
    dx, dy = x1 - x0, y1 - y0
    return (dx * dx + dy * dy) ** 0.5


def _dist_seg(px, py, ax, ay, bx, by):
    """点到线段的距离"""
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    denom = vx * vx + vy * vy
    t = 0.0 if denom == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / denom))
    return _dist(px, py, ax + t * vx, ay + t * vy)


def _hand_end(angle_deg, length):
    """角度：0 = 12 点方向，顺时针为正"""
    rad = math.radians(angle_deg)
    return CX + length * math.sin(rad), CY - length * math.cos(rad)


# 指针端点预计算（避免逐像素调用三角函数）
HOUR_END = _hand_end(-55.0, HOUR_LEN)
MIN_END = _hand_end(62.0, MIN_LEN)
HALF_HAND = HAND_W / 2.0


def sample(x, y):
    """返回 (r,g,b,a)，坐标归一化"""
    if not _in_round_rect(x, y, RADIUS):
        return (0, 0, 0, 0)

    d = _dist(x, y, CX, CY)

    # 表盘圆环
    if R_OUT - RING_W <= d <= R_OUT:
        return C_WHITE + (255,)

    # 指针（带圆头的线段）
    if _dist_seg(x, y, CX, CY, HOUR_END[0], HOUR_END[1]) <= HALF_HAND:
        return C_WHITE + (255,)
    if _dist_seg(x, y, CX, CY, MIN_END[0], MIN_END[1]) <= HALF_HAND:
        return C_WHITE + (255,)

    # 中心圆点
    if d <= DOT_R:
        return C_WHITE + (255,)

    # 背景（垂直渐变）
    t = min(1.0, max(0.0, y))
    return (
        int(_mix(C_GREEN_TOP[0], C_GREEN_BOTTOM[0], t)),
        int(_mix(C_GREEN_TOP[1], C_GREEN_BOTTOM[1], t)),
        int(_mix(C_GREEN_TOP[2], C_GREEN_BOTTOM[2], t)),
        255,
    )


def render(size, ss=3):
    """ss x ss 超采样抗锯齿，返回 RGBA 行数据"""
    rows = []
    step = 1.0 / (size * ss)
    inv = 1.0 / (ss * ss)
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(ss):
                y = (py * ss + sy + 0.5) * step
                for sx in range(ss):
                    x = (px * ss + sx + 0.5) * step
                    sr, sg, sb, sa = sample(x, y)
                    if sa:
                        r += sr * sa
                        g += sg * sa
                        b += sb * sa
                        a += sa
            if a == 0:
                row += b'\x00\x00\x00\x00'
            else:
                row += bytes((
                    min(255, int(r / a + 0.5)),
                    min(255, int(g / a + 0.5)),
                    min(255, int(b / a + 0.5)),
                    min(255, int(a * inv + 0.5)),
                ))
        rows.append(bytes(row))
    return rows


def png_encode(size, rows):
    raw = b''.join(b'\x00' + r for r in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, 'build')
    os.makedirs(out_dir, exist_ok=True)

    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = []
    for size in sizes:
        ss = 4 if size <= 64 else 3
        images.append((size, png_encode(size, render(size, ss))))
        print(f'  渲染 {size}x{size} ...')

    # ---- ICO 容器 ----
    header = struct.pack('<HHH', 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b''
    payload = b''
    for size, png in images:
        dim = 0 if size >= 256 else size
        entries += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
        payload += png

    ico_path = os.path.join(out_dir, 'icon.ico')
    with open(ico_path, 'wb') as fh:
        fh.write(header + entries + payload)

    # 顺带输出一张 256 PNG 供预览
    png_path = os.path.join(out_dir, 'icon.png')
    with open(png_path, 'wb') as fh:
        fh.write(images[-1][1])

    print(f'已生成: {ico_path} ({os.path.getsize(ico_path)} bytes)')
    print(f'已生成: {png_path}')


if __name__ == '__main__':
    main()
