# -*- coding: utf-8 -*-
"""用 pytest 驱动一段纯 JS 单测。

「打印前重新读一遍表格、跟上次预览的快照做比对」这条最要害的判断逻辑
（labelprint/static/row-compare.js 的 normalizeRows / rowsEqual）刻意写成
不摸 DOM 的纯函数，所以可以用系统自带的 node 直接跑，不需要浏览器、
不需要 jsdom 之类的 DOM shim，也不需要给这个项目新增任何 npm 依赖——
这里只是把开发机上已经装好的 node 当一个外部命令调用，跟 npm/package.json
无关，项目本身不多背一条工具链。

这样"表格快照与预览快照是否一致"这件事就从"得有人记得开浏览器验证"
搬回了 `python3 -m pytest` 这一条命令的覆盖范围内。

浏览器里的完整交互流程（含程序化 .value 赋值绕过 input 事件那条路径）
仍然只能靠 tests/frontend/print_invalidation_test.html 在真实浏览器里验证，
详见该文件顶部注释与 tools/run_frontend_tests.py。
"""
import shutil
import subprocess
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent
_NODE_TEST_FILE = _REPO_ROOT / "tests" / "frontend" / "row_compare.test.js"


@pytest.mark.skipif(
    shutil.which("node") is None,
    reason="本机未安装 node，跳过纯 JS 逻辑测试（不影响其余 Python 测试；"
           "部署目标是 Windows 打印机，不依赖 node，这条测试只是开发期的"
           "额外保护）",
)
def test_row_compare_pure_logic_via_node():
    assert _NODE_TEST_FILE.exists(), "找不到 %s" % _NODE_TEST_FILE
    result = subprocess.run(
        ["node", "--test", str(_NODE_TEST_FILE)],
        cwd=str(_REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, (
        "row-compare.js 的纯逻辑单测未通过（node --test 返回码 %d）：\n"
        "--- stdout ---\n%s\n--- stderr ---\n%s"
        % (result.returncode, result.stdout, result.stderr)
    )
