# 标签打印服务守护循环：进程退出 5 秒后重启（由计划任务 LabWorkspace-LabelPrint 开机以 SYSTEM 启动）
# 只监听 127.0.0.1:8080，由网页服务代理；代码随 app.zip 安装在 app\labelprint，Python 用安装包自带的 C:\lab-workspace\python。
# 打印历史库固定在 C:\labelprint\data（与代码分离，升级、回滚 app.zip 都不碰它）。
$ErrorActionPreference = 'Continue'
$Root = 'C:\lab-workspace'
$log = 'E:\lab-workspace\logs\labelprint.log'
# 只取 LABELPRINT_ 开头的配置（如 LABELPRINT_PRINTERS_JSON），数据库口令等不进入该进程
Get-Content "$Root\config\lab.env" | ForEach-Object { if ($_ -match '^\s*(LABELPRINT_[A-Z_]+)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2] } }
if (-not $env:LABELPRINT_DB) { $env:LABELPRINT_DB = 'C:\labelprint\data\labelprint.db' }
$env:PYTHONIOENCODING = 'utf-8'
Set-Location "$Root\app\labelprint"
while ($true) {
  "[$(Get-Date -f 'yyyy-MM-dd HH:mm:ss')] 启动标签打印服务" | Add-Content -Path $log -Encoding UTF8
  cmd /c "`"$Root\python\python.exe`" -m labelprint.app >> `"$log`" 2>&1"
  "[$(Get-Date -f 'yyyy-MM-dd HH:mm:ss')] 标签打印服务退出（退出码 $LASTEXITCODE），5 秒后重启" | Add-Content -Path $log -Encoding UTF8
  Start-Sleep -Seconds 5
}
