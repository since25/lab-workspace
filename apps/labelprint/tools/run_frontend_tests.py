# -*- coding: utf-8 -*-
"""前端回归测试一键跑法。

起一个本地静态文件服务器 -> 用机器上已经装好的浏览器（Chrome 或 Windows
自带的 Edge，二者都是 Chromium 内核，headless 相关命令行参数一致）以
headless 方式打开 tests/frontend/print_invalidation_test.html -> 读页面里
的测试结果判定通过与否 -> 返回对应退出码。

不新增任何依赖：静态服务器用标准库 http.server，浏览器用系统上已经存在的
可执行文件，不装 Selenium/Playwright，不建 npm/package.json。目的是把
"预览过期后打印会送出旧数据"这类前端 bug 的回归测试从"得有人记得手动开
浏览器点一遍"降级成"跑一条命令"，减少这条测试被人遗忘、慢慢腐烂的概率。

用法：
    python3 tools/run_frontend_tests.py

退出码：
    0   全部通过
    1   跑起来了，但有测试失败
    2   环境问题（找不到浏览器、浏览器异常退出、解析不到结果等），不代表
        代码有 bug，只说明这次没能得出结论

可选环境变量：
    LABELPRINT_TEST_BROWSER   显式指定浏览器可执行文件路径，跳过自动探测
"""
import http.server
import os
import re
import shutil
import subprocess
import sys
import threading

sys.stdout.reconfigure(encoding="utf-8")  # 避免 Windows 控制台代码页把中文输出转乱码

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_TEST_PAGE_REL = "tests/frontend/print_invalidation_test.html"

# Chrome 优先；找不到就退而求其次找 Edge——Windows 从 10/11 开始自带 Edge，
# 部署目标机大概率不用额外装任何东西就有一个能用的 headless 浏览器。
# shutil.which() 对绝对路径和裸命令名都适用：绝对路径直接判断文件是否存在
# 且可执行，裸命令名走 PATH 查找。
_CANDIDATE_BROWSERS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",  # macOS
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",  # macOS
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
    "microsoft-edge",
]


def _find_browser():
    override = os.environ.get("LABELPRINT_TEST_BROWSER")
    if override:
        return override
    for candidate in _CANDIDATE_BROWSERS:
        found = shutil.which(candidate)
        if found:
            return found
    return None


def _start_static_server():
    """在仓库根起一个静态文件服务器，端口交给操作系统分配，避免和其他进程撞车。"""
    def handler(*args, **kwargs):
        return http.server.SimpleHTTPRequestHandler(*args, directory=_REPO_ROOT, **kwargs)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main():
    browser = _find_browser()
    if not browser:
        print("找不到可用的浏览器（尝试过 Chrome 与 Edge 的常见安装路径）。")
        print("可以设置 LABELPRINT_TEST_BROWSER 环境变量指向浏览器可执行文件后重试。")
        return 2

    server = _start_static_server()
    port = server.server_address[1]
    url = "http://127.0.0.1:%d/%s" % (port, _TEST_PAGE_REL)

    try:
        result = subprocess.run(
            [browser, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--virtual-time-budget=5000", "--dump-dom", url],
            capture_output=True, text=True, timeout=30,
        )
    except subprocess.TimeoutExpired:
        print("浏览器 30 秒内没有返回结果，判定为环境问题。")
        return 2
    except OSError as exc:
        # LABELPRINT_TEST_BROWSER 指向一个不存在或没有执行权限的路径时，
        # subprocess.run 在真正启动子进程这一步会抛 FileNotFoundError /
        # PermissionError（都是 OSError 的子类），不是"测试跑了但失败"，
        # 是环境配置问题，必须用退出码 2 而不是 1 区分开——否则会被误读成
        # "代码有 bug"，去查代码，其实是浏览器路径写错了。
        print("无法启动浏览器进程：%s" % exc)
        print("请检查浏览器路径是否正确——如果设置了 LABELPRINT_TEST_BROWSER "
              "环境变量，确认它指向的文件确实存在且可执行。")
        return 2
    finally:
        server.shutdown()

    if result.returncode != 0:
        print("浏览器进程异常退出（返回码 %d）：" % result.returncode)
        print(result.stderr[-2000:])
        return 2

    dom = result.stdout
    status_match = re.search(r'data-status="([a-z]+)"', dom)
    title_match = re.search(r"<title>([^<]*)</title>", dom)
    output_match = re.search(r'<pre id="test-output">(.*?)</pre>', dom, re.S)

    print("使用浏览器：%s" % browser)
    print("测试页面：%s" % url)
    print("-" * 60)

    if not output_match or not status_match:
        print("未能从页面里解析出测试结果，可能页面结构变了或测试脚本本身出错。")
        print("页面标题：%s" % (title_match.group(1) if title_match else "（未知）"))
        return 2

    print(output_match.group(1).strip())
    print("-" * 60)

    if status_match.group(1) == "pass":
        print("结论：全部通过")
        return 0

    print("结论：存在失败项")
    return 1


if __name__ == "__main__":
    sys.exit(main())
