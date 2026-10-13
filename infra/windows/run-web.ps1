# 网页服务守护循环：进程退出 5 秒后重启（由计划任务 LabWorkspace-Web 开机以 SYSTEM 启动）
# 日志用 cmd 重定向写入，运行中也能随时查看（沿用标签打印服务在本机实测过的写法）
$ErrorActionPreference = 'Continue'
$Root = 'C:\lab-workspace'
$log = 'E:\lab-workspace\logs\web.log'
Get-Content "$Root\config\lab.env" | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2] } }
Set-Location "$Root\app\web"
while ($true) {
  "[$(Get-Date -f 'yyyy-MM-dd HH:mm:ss')] 启动网页服务" | Add-Content -Path $log -Encoding UTF8
  cmd /c "`"$Root\node\node.exe`" server.js >> `"$log`" 2>&1"
  "[$(Get-Date -f 'yyyy-MM-dd HH:mm:ss')] 网页服务退出（退出码 $LASTEXITCODE），5 秒后重启" | Add-Content -Path $log -Encoding UTF8
  Start-Sleep -Seconds 5
}
