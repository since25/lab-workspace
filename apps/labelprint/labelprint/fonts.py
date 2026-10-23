# -*- coding: utf-8 -*-
"""字体解析：目标机与开发机（macOS）尽量用同一款字体，缩小两边渲染差异。

审查发现开发机上如果装了 Microsoft Office（Word/Excel/PowerPoint 任一个），
其安装目录下自带的 DFonts 里就有真正的微软雅黑（跟目标机 Windows 系统自带
的是同一款字体），比开发机原来兜底用的华文黑体准得多——曾经真实发生过
"生产字体（微软雅黑加粗）能测出的错标，开发机字体（华文黑体）完全测不出"
的情况（下划线被压进第二行、字压根看不出来）。所以 macOS 候选优先找 Office
自带的这一份，找不到（没装任何 Office 应用）才退回华文黑体兜底——退可以
兜底但不能替代，改完 render.py 涉及排版的部分仍必须在目标机上用真实的
微软雅黑再跑一次 verify.bat，见 README「给以后改 render.py 的人」一节。
"""
import os

# (路径, ttc 内字体索引)。Office 三个应用的 DFonts 目录下是完全相同的文件，
# 装了其中任意一个就有——三个都列上，用户可能只装了 Word 或只装了 Excel。
# 索引已核对：Office 版 msyhbd.ttc/msyh.ttc 的 index 0 就是"Microsoft YaHei"
# （Bold/Regular），跟 Windows 系统字体候选用的索引一致。
_BOLD = [
    (r"C:\Windows\Fonts\msyhbd.ttc", 0),
    ("/Applications/Microsoft Word.app/Contents/Resources/DFonts/msyhbd.ttc", 0),
    ("/Applications/Microsoft Excel.app/Contents/Resources/DFonts/msyhbd.ttc", 0),
    ("/Applications/Microsoft PowerPoint.app/Contents/Resources/DFonts/msyhbd.ttc", 0),
    ("/System/Library/Fonts/STHeiti Medium.ttc", 1),
]
_REGULAR = [
    (r"C:\Windows\Fonts\msyh.ttc", 0),
    ("/Applications/Microsoft Word.app/Contents/Resources/DFonts/msyh.ttc", 0),
    ("/Applications/Microsoft Excel.app/Contents/Resources/DFonts/msyh.ttc", 0),
    ("/Applications/Microsoft PowerPoint.app/Contents/Resources/DFonts/msyh.ttc", 0),
    ("/System/Library/Fonts/STHeiti Medium.ttc", 1),
]


def _first_existing(candidates):
    for path, index in candidates:
        if os.path.exists(path):
            return path, index
    raise RuntimeError("找不到可用字体，候选：%s" % [c[0] for c in candidates])


def resolve():
    """返回 (粗体路径, 粗体索引, 常规路径, 常规索引)。"""
    bp, bi = _first_existing(_BOLD)
    rp, ri = _first_existing(_REGULAR)
    return bp, bi, rp, ri
