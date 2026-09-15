# -*- coding: utf-8 -*-
"""
make-license-rtf.py —— 把安装协议文本转成 RTF

NSIS 的 MUI_PAGE_LICENSE 在中文 Windows 下按 ANSI 代码页解析 .txt，
UTF-8 中文会显示成乱码。RTF 用 ASCII 的 \\uN? 转义表示 Unicode，
不受代码页影响，任何语言环境都能正确显示。
"""

import os

FONT = 'Microsoft YaHei'

TITLE = 'icrontab - 定时任务管理器'
BODY = """Copyright (c) 2026 icrontab

本软件基于 MIT 协议发布。

特此授权，任何人均可免费获得本软件的副本及相关文档文件（以下简称"软件"），并可在不受限制的情况下处理本软件，包括但不限于使用、复制、修改、合并、发布、分发、再许可和/或销售本软件的副本，并允许获得本软件的人按上述方式使用，但须遵守以下条件：

上述版权声明和本许可声明应包含在本软件的所有副本或主要部分中。

本软件按"现状"提供，不附带任何明示或默示的保证，包括但不限于对适销性、特定用途适用性和不侵权的保证。在任何情况下，作者或版权持有人均不对因软件或软件的使用或其他交易而引起的任何索赔、损害或其他责任承担责任。

—————————————————————

使用说明：

1. 本软件用于在本机管理定时任务，数据以 JSON 文件形式保存在本地（默认位于用户数据目录，可在"设置"中更改）。卸载不会删除这些数据。
2. 任务通过系统 shell 执行，请勿配置来源不明的命令。"""


def esc(text):
    """转义 RTF：非 ASCII 转 \\uN?，特殊字符转义"""
    out = []
    for ch in text:
        code = ord(ch)
        if ch == '\\':
            out.append('\\\\')
        elif ch == '{':
            out.append('\\{')
        elif ch == '}':
            out.append('\\}')
        elif ch == '\n':
            out.append('\\par\n')
        elif ch == '\r':
            continue
        elif code < 128:
            out.append(ch)
        else:
            # RTF \uN 使用有符号 16 位；BMP 内的码位直接使用，超出则用代理对
            if code > 0xFFFF:
                code -= 0x10000
                hi = 0xD800 + (code >> 10)
                lo = 0xDC00 + (code & 0x3FF)
                out.append(f'\\u{hi if hi < 0x8000 else hi - 0x10000}?\\u{lo if lo < 0x8000 else lo - 0x10000}?')
            else:
                out.append(f'\\u{code if code < 0x8000 else code - 0x10000}?')
    return ''.join(out)


def build_rtf():
    parts = [
        r'{\rtf1\ansi\ansicpg936\deff0\uc1',
        r'{\fonttbl{\f0\fnil\fcharset134 ' + FONT + r';}{\f1\fnil\fcharset134 SimSun;}}',
        r'{\colortbl;\red0\green0\blue0;\red90\green90\blue90;}',
        r'\viewkind4\pard',
        # 标题
        r'\f0\fs28\b ' + esc(TITLE) + r'\b0\par',
        r'\fs18\par',
    ]
    for block in BODY.split('\n\n'):
        block = block.strip()
        if not block:
            continue
        if block.startswith('—'):
            parts.append(r'\pard\qc\cf2\fs18 ' + esc(block) + r'\cf1\par\par')
        elif block.startswith('Copyright'):
            parts.append(r'\pard\cf2\fs18 ' + esc(block) + r'\cf1\par\par')
        else:
            parts.append(r'\pard\fs18 ' + esc(block) + r'\par\par')
    parts.append(r'}')
    return '\n'.join(parts)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, 'build', 'license.rtf')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    rtf = build_rtf()
    # RTF 必须是纯 ASCII 字节
    rtf.encode('ascii')
    with open(out, 'w', encoding='ascii', newline='') as fh:
        fh.write(rtf)
    print(f'已生成: {out} ({os.path.getsize(out)} bytes, 纯 ASCII)')


if __name__ == '__main__':
    main()
