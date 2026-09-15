# -*- coding: utf-8 -*-
"""
shot-installer.py —— 启动 NSIS 安装向导、自动点到协议页并截图

用法：
    python scripts/shot-installer.py <安装包exe> <输出png>
"""

import ctypes
import ctypes.wintypes as wt
import os
import subprocess
import sys
import time

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

WM_CLOSE = 0x0010
BM_CLICK = 0x00F5

# ---- 复用 shot-screen.py 的抓屏逻辑（文件名带连字符，需用 importlib 加载）----
import importlib.util

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    'shot_screen', os.path.join(_SCRIPT_DIR, 'shot-screen.py'))
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
grab, png_encode = _mod.grab, _mod.png_encode

user32.SetProcessDPIAware()


def window_text(hwnd):
    n = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def class_name(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


ENUM_PROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)  # (返回值, HWND, LPARAM)


def find_installer_window():
    result = []

    @ENUM_PROC
    def on_window(hwnd, _):
        title = window_text(hwnd)
        if 'icrontab' in title and class_name(hwnd) == '#32770':
            result.append(hwnd)
        return True

    user32.EnumWindows(on_window, 0)
    return result[0] if result else None


def find_buttons(parent):
    buttons = []

    @ENUM_PROC
    def on_child(hwnd, _):
        if class_name(hwnd) == 'Button':
            buttons.append((hwnd, window_text(hwnd)))
        return True

    user32.EnumChildWindows(parent, on_child, 0)
    return buttons


def click_button(parent, keywords):
    for hwnd, text in find_buttons(parent):
        if any(k in text for k in keywords):
            user32.SendMessageW(hwnd, BM_CLICK, 0, 0)
            return True
    return False


def screenshot(path):
    user32.SetProcessDPIAware()
    w = user32.GetSystemMetrics(0)
    h = user32.GetSystemMetrics(1)
    raw = grab(w, h)
    stride = w * 4
    rows = []
    for y in range(h):
        line = raw[y * stride:(y + 1) * stride]
        row = bytearray(stride)
        row[0::4] = line[2::4]
        row[1::4] = line[1::4]
        row[2::4] = line[0::4]
        row[3::4] = b'\xff' * w
        rows.append(bytes(row))
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(png_encode(w, h, rows))
    print(f'已截图: {path}')


def main():
    exe = sys.argv[1]
    out = sys.argv[2]

    proc = subprocess.Popen([exe])
    time.sleep(5)

    win = find_installer_window()
    if not win:
        print('未找到安装向导窗口')
        subprocess.run(['taskkill', '/PID', str(proc.pid), '/F'],
                       capture_output=True)
        sys.exit(1)
    print(f'找到向导窗口 HWND=0x{win:X} 标题="{window_text(win)}"')

    # 逐页点「下一步」直到出现协议页按钮「我接受」
    for _ in range(3):
        if click_button(win, ['我接受']):
            print('已进入协议页')
            break
        if not click_button(win, ['下一步']):
            print('没有可点击的「下一步」，可能已在协议页')
            break
        time.sleep(1.5)

    time.sleep(1.5)
    screenshot(out)

    user32.PostMessageW(win, WM_CLOSE, 0, 0)
    time.sleep(1)
    subprocess.run(['taskkill', '/PID', str(proc.pid), '/F'], capture_output=True)
    print('已关闭安装向导')


if __name__ == '__main__':
    main()
