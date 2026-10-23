# -*- coding: utf-8 -*-
"""生成 numeric.xls 夹具文件，用于测试 xlrd 的浮点转换逻辑。

xlrd 从数值单元格读取时，必然返回 float 类型（通过 struct.unpack）。
这个脚本生成的测试文件覆盖：
- 纯数字样品名（数字类型存储）→ 应被转换为 "数字" 而不是 "数字.0"
- 整数浓度 → 应转换为 "128" 而不是 "128.0"
- 小数浓度 → 应转换为 "128.5"
- 空字段 → 应读为空字符串
"""
import xlwt

def create_numeric_xls():
    """创建 numeric.xls 夹具文件。"""
    wb = xlwt.Workbook()
    ws = wb.add_sheet('Sheet1')

    # 表头
    ws.write(0, 0, '样品名称')
    ws.write(0, 1, '浓度(ng/uL)')
    ws.write(0, 2, '260/280')
    ws.write(0, 3, '备注')

    # 行 1：纯数字样品名（作为数字类型存储），会被 xlrd 读成 float
    ws.write(1, 0, 2024001.0)  # 数字类型，xlrd 返回 float
    ws.write(1, 1, 128.0)      # 整数浓度，xlrd 返回 float
    ws.write(1, 2, '')         # 空的 ratio
    ws.write(1, 3, '')         # 空的 note

    # 行 2：正常样品名，小数浓度
    ws.write(2, 0, 'S2')
    ws.write(2, 1, 96.5)       # 小数浓度
    ws.write(2, 2, 1.79)       # ratio
    ws.write(2, 3, '备注')

    # 行 3：正常样品名，整数浓度（直接写整数）
    ws.write(3, 0, 'S3')
    ws.write(3, 1, 200)        # 整数
    ws.write(3, 2, '')
    ws.write(3, 3, '')

    # 行 4：只有样品名，其余为空
    ws.write(4, 0, 'S4')
    ws.write(4, 1, '')
    ws.write(4, 2, '')
    ws.write(4, 3, '')

    wb.save('numeric.xls')

if __name__ == '__main__':
    create_numeric_xls()
    print('Created numeric.xls')
