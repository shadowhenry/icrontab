# -*- coding: utf-8 -*-
"""
shot-screen.py —— 用 ctypes 抓取全屏截图（不依赖 Pillow / .NET）

用法：
    python scripts/shot-screen.py <输出png> [等待秒数] [要启动的exe] [启动后是否关闭]

用途：验证 NSIS 安装向导等原生 Windows 界面的显示效果。
"""

import ctypes
import ctypes.wintypes as wt
import os
import struct
import subprocess
import sys
import time
import zlib

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

SRCCOPY = 0x00CC0020
DIB_RGB_COLORS = 0


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wt.DWORD),
        ("biWidth", ctypes.c_long),
        ("biHeight", ctypes.c_long),
        ("biPlanes", wt.WORD),
        ("biBitCount", wt.WORD),
        ("biCompression", wt.DWORD),
        ("biSizeImage", wt.DWORD),
        ("biXPelsPerMeter", ctypes.c_long),
        ("biYPelsPerMeter", ctypes.c_long),
        ("biClrUsed", wt.DWORD),
        ("biClrImportant", wt.DWORD),
    ]


def png_encode(width, height, rgba_rows):
    raw = b''.join(b'\x00' + row for row in rgba_rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(raw, 6))
            + chunk(b'IEND', b''))


def grab(width, height):
    hdc = user32.GetDC(0)
    memdc = gdi32.CreateCompatibleDC(hdc)
    hbmp = gdi32.CreateCompatibleBitmap(hdc, width, height)
    gdi32.SelectObject(memdc, hbmp)
    gdi32.BitBlt(memdc, 0, 0, width, height, hdc, 0, 0, SRCCOPY)

    bmi = BITMAPINFOHEADER()
    bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.biWidth = width
    bmi.biHeight = -height          # 负数 = 自上而下
    bmi.biPlanes = 1
    bmi.biBitCount = 32
    bmi.biCompression = 0

    bufsize = width * height * 4
    buf = ctypes.create_string_buffer(bufsize)
    gdi32.GetDIBits(memdc, hbmp, 0, height, buf, ctypes.byref(bmi), DIB_RGB_COLORS)

    gdi32.DeleteObject(hbmp)
    gdi32.DeleteDC(memdc)
    user32.ReleaseDC(0, hdc)
    return buf.raw


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'shot.png'
    wait = float(sys.argv[2]) if len(sys.argv) > 2 else 0
    exe = sys.argv[3] if len(sys.argv) > 3 else None
    kill = (sys.argv[4].lower() == 'kill') if len(sys.argv) > 4 else False

    proc = None
    if exe:
        extra = sys.argv[5:] if len(sys.argv) > 5 else []
        proc = subprocess.Popen([exe] + extra)
    if wait:
        time.sleep(wait)

    user32.SetProcessDPIAware()
    width = user32.GetSystemMetrics(0)
    height = user32.GetSystemMetrics(1)
    raw = grab(width, height)

    # BGRA -> RGBA，同时做 alpha 处理
    rows = []
    stride = width * 4
    for y in range(height):
        line = raw[y * stride:(y + 1) * stride]
        row = bytearray(stride)
        row[0::4] = line[2::4]
        row[1::4] = line[1::4]
        row[2::4] = line[0::4]
        row[3::4] = b'\xff' * width
        rows.append(bytes(row))

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'wb') as fh:
        fh.write(png_encode(width, height, rows))
    print(f'已截图: {out} ({width}x{height})')

    if proc and kill:
        proc.terminate()
        print(f'已关闭进程 PID={proc.pid}')


if __name__ == '__main__':
    main()
