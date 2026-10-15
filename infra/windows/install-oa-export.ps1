# 独立安装 OA 导出任务；执行前须确认目标服务器、配置文件与每周六 03:00 的运行时间。
param([string]$Archive = 'C:\lab-workspace\incoming\oa-export.zip')
$ErrorActionPreference = 'Stop'
$Root = 'C:\lab-workspace'
$Target = "$Root\automation\oa-export"
$EnvFile = "$Root\config\oa.env"
$Output = 'E:\lab-workspace\oa-materials'
$TaskName = 'LabWorkspace-OA-Export'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw 'OA export task already exists; refusing to overwrite.' }
if (Test-Path $Target) { throw 'OA export directory already exists; refusing to overwrite.' }
foreach ($p in @($Archive, $EnvFile, "$Root\node\node.exe")) {
  if (-not (Test-Path $p -PathType Leaf)) { throw "Required file missing: $p" }
}
if (-not (Test-Path 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')) { throw 'Microsoft Edge is missing.' }

# 单独保护 OA 配置，不修改现有工作台账号与数据库配置。
& icacls $EnvFile /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict OA config permissions.' }
New-Item -ItemType Directory -Force -Path $Output, "$Root\automation", 'E:\lab-workspace\logs' | Out-Null
& icacls $Output /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict OA export permissions.' }
Expand-Archive -Path $Archive -DestinationPath $Target
& "$Root\node\node.exe" "$Target\src\cli.mjs" --env $EnvFile --check
if ($LASTEXITCODE -ne 0) { throw 'OA config validation failed; scheduled task was not created.' }

$Action = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Target\run.ps1`"" -WorkingDirectory $Target
$Trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Saturday -At '03:00'
# 该机 Edge 在 SYSTEM 下退出码为 1002；使用执行安装的现有管理员账号。
# S4U 不保存 Windows 密码，也不要求账号保持交互登录；OA 仍每次用配置账号登录。
$Principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType S4U -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings `
  -Description '每周六服务器时间 03:00 重新登录 OA 并导出，按配置增量更新物料，保留本地申请和已用完标记。' | Out-Null
Write-Output 'OA export task installed. Run it once manually and check the exit code and downloaded file.'
