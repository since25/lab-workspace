# 卸载（回滚）：停止并移除计划任务、防火墙规则、PostgreSQL 服务。
# 数据（E:\lab-workspace\pgdata、backups）与程序目录默认保留；确认不要后再手动删除：
#   Remove-Item C:\lab-workspace, E:\lab-workspace -Recurse -Force
$ErrorActionPreference = 'Continue'
$Root = 'C:\lab-workspace'
foreach ($t in @('LabWorkspace-Web', 'LabWorkspace-R', 'LabWorkspace-Backup')) {
  schtasks /End /TN $t 2>$null | Out-Null
  schtasks /Delete /TN $t /F 2>$null | Out-Null
}
Get-CimInstance Win32_Process |
  Where-Object { $_.ExecutablePath -like "$Root\*" -or ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*lab-workspace\deploy\run-*') } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-NetFirewallRule -Name 'LabWorkspace-Web-In-TCP-3000' -ErrorAction SilentlyContinue
if (Get-Service 'lab-workspace-postgresql' -ErrorAction SilentlyContinue) {
  Stop-Service 'lab-workspace-postgresql' -Force
  & "$Root\pgsql\bin\pg_ctl.exe" unregister -N 'lab-workspace-postgresql'
}
'已停止并移除计划任务、防火墙规则和数据库服务；数据目录 E:\lab-workspace 保留。'
