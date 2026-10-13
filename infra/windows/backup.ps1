# 每日数据库备份（计划任务 LabWorkspace-Backup，每天 02:30）：pg_dump 自定义格式，保留 30 天
# 恢复：pg_restore -h 127.0.0.1 -U lab_app -d lab_workspace --clean <备份文件>
$ErrorActionPreference = 'Stop'
$Root = 'C:\lab-workspace'
$dir = 'E:\lab-workspace\backups'
$log = 'E:\lab-workspace\logs\backup.log'
$cfg = @{}
Get-Content "$Root\config\lab.env" | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)=(.*)$') { $cfg[$Matches[1]] = $Matches[2] } }
$u = [uri]$cfg.DATABASE_URL
$env:PGPASSWORD = $u.UserInfo.Split(':')[1]
$file = Join-Path $dir ("lab_workspace_{0}.dump" -f (Get-Date -f 'yyyyMMdd_HHmm'))
& { $ErrorActionPreference = 'Continue'; & "$Root\pgsql\bin\pg_dump.exe" -h 127.0.0.1 -p $u.Port -U lab_app -Fc -f $file lab_workspace 2>&1 | Out-Null }
$code = $LASTEXITCODE
Remove-Item Env:\PGPASSWORD
if ($code -eq 0) {
  "[$(Get-Date -f 'yyyy-MM-dd HH:mm:ss')] 备份完成 $file ($([int]((Get-Item $file).Length / 1KB)) KB)" | Add-Content -Path $log -Encoding UTF8
  Get-ChildItem $dir -Filter 'lab_workspace_*.dump' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
} else {
  "[$(Get-Date -f 'yyyy-MM-dd HH:mm:ss')] 备份失败，pg_dump 退出码 $code" | Add-Content -Path $log -Encoding UTF8
  exit 1
}
