# 分析服务守护循环：进程退出 5 秒后重启（由计划任务 LabWorkspace-R 开机以 SYSTEM 启动）
# 只监听 127.0.0.1，由网页服务转发；临时文件在 LAB_TEMP_DIR，按 TEMP_JOB_TTL_HOURS 自动清理
$ErrorActionPreference = 'Continue'
$Root = 'C:\lab-workspace'
$log = 'E:\lab-workspace\logs\r-engine.log'
Get-Content "$Root\config\lab.env" | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2] } }
Set-Location "$Root\app\r-engine"
while ($true) {
  "[$(Get-Date -f 'yyyy-MM-dd HH:mm:ss')] 启动分析服务" | Add-Content -Path $log -Encoding UTF8
  cmd /c "`"$Root\R\bin\Rscript.exe`" start.R >> `"$log`" 2>&1"
  "[$(Get-Date -f 'yyyy-MM-dd HH:mm:ss')] 分析服务退出（退出码 $LASTEXITCODE），5 秒后重启" | Add-Content -Path $log -Encoding UTF8
  Start-Sleep -Seconds 5
}
