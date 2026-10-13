# Lab Workspace 安装 / 升级脚本（windows-wg，管理员 PowerShell 执行，可安全重复执行）
#
# 前提：已把安装包解压到 C:\lab-workspace\incoming\（含 app.zip、runtime\ 目录），
#       本脚本位于 C:\lab-workspace\incoming\deploy\。
# 做的事：装运行环境（Node / PostgreSQL / R 及 R 包，全部用本地文件，不依赖外网）→
#         初始化数据库（仅首次）→ 更新应用文件 → 执行数据库迁移 → 注册开机自启任务 →
#         防火墙放行 3000 → 启动并做健康检查。
# 不做的事：不动标签打印服务（8080）、MariaDB（3306）及其防火墙规则。
$ErrorActionPreference = 'Stop'

$Root     = 'C:\lab-workspace'
$Incoming = "$Root\incoming"
$Runtime  = "$Incoming\runtime"
$DataRoot = 'E:\lab-workspace'
$PgData   = "$DataRoot\pgdata"
$Jobs     = "$DataRoot\jobs"
$Logs     = "$DataRoot\logs"
$Backups  = "$DataRoot\backups"
$EnvFile  = "$Root\config\lab.env"
$PgSvc    = 'lab-workspace-postgresql'
$WebPort  = 3000
$RPort    = 8001
$PgPort   = 5432

function Step($m) { "[$(Get-Date -f 'HH:mm:ss')] $m" }
function NewSecret([int]$n) {
  $b = New-Object byte[] $n
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  ([Convert]::ToBase64String($b) -replace '[+/=]', '').Substring(0, [Math]::Min($n, 40))
}
# 外部命令写 stderr 时 PowerShell 5.1 会升级成终止错误；在子作用域里降级并检查退出码
function Run([string]$exe, [string[]]$argv) {
  & { $ErrorActionPreference = 'Continue'; & $exe @argv 2>&1 | ForEach-Object { "$_" } }
  if ($LASTEXITCODE -ne 0) { throw "$exe 退出码 $LASTEXITCODE" }
}

# ---------- 0. 端口占用检查（排除本系统自己的进程） ----------
foreach ($p in @($WebPort, $RPort, $PgPort)) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    $proc = (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).Path
    if ($proc -and $proc -notlike "$Root\*") { throw "端口 $p 已被其他程序占用：$proc" }
  }
}

foreach ($d in @("$Root\config", "$Root\app", $DataRoot, $Jobs, $Logs, $Backups)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

# ---------- 1. 运行环境 ----------
if (-not (Test-Path "$Root\node\node.exe")) {
  Step '解压 Node.js'
  $zip = Get-ChildItem "$Runtime\node-*-win-x64.zip" | Select-Object -First 1
  Expand-Archive $zip.FullName -DestinationPath "$Root\_node_tmp" -Force
  Move-Item (Get-ChildItem "$Root\_node_tmp" | Select-Object -First 1).FullName "$Root\node"
  Remove-Item "$Root\_node_tmp" -Recurse -Force
}
if (-not (Test-Path "$Root\pgsql\bin\pg_ctl.exe")) {
  Step '解压 PostgreSQL（约 300 MB，需要几分钟）'
  $zip = Get-ChildItem "$Runtime\postgresql-*-windows-x64-binaries.zip" | Select-Object -First 1
  Expand-Archive $zip.FullName -DestinationPath $Root -Force   # 包内顶层目录即 pgsql\
}
if (-not (Test-Path "$Root\R\bin\Rscript.exe")) {
  Step '静默安装 R'
  $exe = Get-ChildItem "$Runtime\R-*-win.exe" | Select-Object -First 1
  $p = Start-Process $exe.FullName -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS', "/DIR=$Root\R" -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "R 安装失败，退出码 $($p.ExitCode)" }
}
$Node = "$Root\node\node.exe"
$Rscript = "$Root\R\bin\Rscript.exe"
$Pg = "$Root\pgsql\bin"

Step '安装 R 包（来自本地仓库，已装的跳过）'
$repo = 'file:///' + ($Runtime -replace '\\', '/') + '/rpkgs'
$rcode = @"
pk <- c('plumber','jsonlite','magrittr','dplyr','gamlss','gamlss.dist','writexl','zip','digest','tidyr','base64enc','Biostrings','sangerseqR','pwalign')
miss <- pk[!vapply(pk, requireNamespace, logical(1), quietly = TRUE)]
if (length(miss)) install.packages(miss, repos = '$repo', type = 'win.binary', dependencies = c('Depends','Imports','LinkingTo'))
bad <- pk[!vapply(pk, requireNamespace, logical(1), quietly = TRUE)]
if (length(bad)) { cat('MISSING R PACKAGES:', bad, '\n'); quit(status = 1) }
cat('R packages OK\n')
"@
# 多行代码不能用 -e 传：PowerShell 5.1 传参会丢失，Rscript 静默什么都不做，故写入临时文件执行
$rfile = "$env:TEMP\lab-workspace-rpkgs.R"
Set-Content -Path $rfile -Value $rcode -Encoding ASCII   # R 代码只含 ASCII；UTF8 会带 BOM
try { Run $Rscript @($rfile) } finally { Remove-Item $rfile -Force -ErrorAction SilentlyContinue }

# ---------- 2. 配置文件（首次生成随机口令，之后保持不变） ----------
if (-not (Test-Path $EnvFile)) {
  Step '生成配置文件'
  $pgSuper = NewSecret 32
  $pgApp = NewSecret 32
  @(
    "PG_SUPERUSER_PASSWORD=$pgSuper",
    "DATABASE_URL=postgres://lab_app:$pgApp@127.0.0.1:$PgPort/lab_workspace",
    "SESSION_SECRET=$(NewSecret 48)",
    "R_ENGINE_URL=http://127.0.0.1:$RPort",
    "R_ENGINE_PORT=$RPort",
    "PORT=$WebPort",
    "HOSTNAME=0.0.0.0",
    "NODE_ENV=production",
    "COOKIE_SECURE=false",
    "TEMP_JOB_TTL_HOURS=24",
    "MAX_UPLOAD_MB=200",
    "LAB_TEMP_DIR=$Jobs",
    "EDITR_ENABLE_PARALLEL=false"
  ) | Set-Content -Path $EnvFile -Encoding ASCII
  # 仅 SYSTEM 与管理员可读
  Run 'icacls' @("$Root\config", '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
}
$cfg = @{}
Get-Content $EnvFile | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)=(.*)$') { $cfg[$Matches[1]] = $Matches[2] } }
$appPw = ([uri]$cfg.DATABASE_URL).UserInfo.Split(':')[1]

# ---------- 3. 数据库（仅首次初始化） ----------
if (-not (Test-Path "$PgData\PG_VERSION")) {
  Step '初始化 PostgreSQL 数据目录'
  $pwfile = "$Root\config\pg_pw.tmp"
  Set-Content -Path $pwfile -Value $cfg.PG_SUPERUSER_PASSWORD -Encoding ASCII -NoNewline
  try {
    Run "$Pg\initdb.exe" @('-D', $PgData, '-U', 'postgres', '--pwfile', $pwfile, '-A', 'scram-sha-256', '-E', 'UTF8', '--locale=C')
  } finally { Remove-Item $pwfile -Force }
  Add-Content -Path "$PgData\postgresql.conf" -Encoding ASCII -Value @(
    '', '# lab-workspace', "listen_addresses = 'localhost'", "port = $PgPort",
    'logging_collector = on', "log_directory = 'log'", "log_filename = 'postgresql-%a.log'", 'log_truncate_on_rotation = on'
  )
  # 服务以 Network Service 身份运行，授予数据目录完全控制
  Run 'icacls' @($PgData, '/grant', '*S-1-5-20:(OI)(CI)F', '/T', '/Q')
}
if (-not (Get-Service $PgSvc -ErrorAction SilentlyContinue)) {
  Step '注册 PostgreSQL 服务'
  Run "$Pg\pg_ctl.exe" @('register', '-N', $PgSvc, '-U', 'NT AUTHORITY\NetworkService', '-D', $PgData, '-S', 'auto')
}
if ((Get-Service $PgSvc).Status -ne 'Running') { Start-Service $PgSvc }
for ($i = 0; $i -lt 30; $i++) {
  & { $ErrorActionPreference = 'Continue'; & "$Pg\pg_isready.exe" -h 127.0.0.1 -p $PgPort 2>&1 | Out-Null }
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 1
}
$env:PGPASSWORD = $cfg.PG_SUPERUSER_PASSWORD
$hasRole = & "$Pg\psql.exe" -h 127.0.0.1 -p $PgPort -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='lab_app'"
if ($hasRole -ne '1') {
  Step '创建数据库账号与数据库'
  Run "$Pg\psql.exe" @('-h', '127.0.0.1', '-p', "$PgPort", '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', "CREATE ROLE lab_app LOGIN PASSWORD '$appPw'")
  Run "$Pg\psql.exe" @('-h', '127.0.0.1', '-p', "$PgPort", '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE lab_workspace OWNER lab_app')
}
Remove-Item Env:\PGPASSWORD

# ---------- 4. 应用文件 ----------
Step '停止旧进程并更新应用文件'
foreach ($t in @('LabWorkspace-Web', 'LabWorkspace-R')) {
  & { $ErrorActionPreference = 'SilentlyContinue'; schtasks /End /TN $t 2>$null } | Out-Null
}
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -like "$Root\*" -and $_.Name -in @('node.exe', 'Rscript.exe', 'Rterm.exe') -or ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*lab-workspace\deploy\run-*') } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
if (Test-Path "$Root\app") { Remove-Item "$Root\app" -Recurse -Force }
Expand-Archive "$Incoming\app.zip" -DestinationPath "$Root\app" -Force
New-Item -ItemType Directory -Force -Path "$Root\deploy" | Out-Null
Copy-Item "$Incoming\deploy\*.ps1" "$Root\deploy\" -Force

Step '执行数据库迁移'
$env:DATABASE_URL = $cfg.DATABASE_URL
$env:MIGRATIONS_DIR = "$Root\app\db\migrations"
Run $Node @("$Root\app\scripts\migrate.mjs")
Remove-Item Env:\DATABASE_URL, Env:\MIGRATIONS_DIR

# ---------- 5. 开机自启任务与备份任务 ----------
Step '注册计划任务'
$ps = 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File'
schtasks /Create /TN 'LabWorkspace-R'   /SC ONSTART /RU SYSTEM /RL HIGHEST /F /TR "$ps $Root\deploy\run-r.ps1" | Out-Null
schtasks /Create /TN 'LabWorkspace-Web' /SC ONSTART /RU SYSTEM /RL HIGHEST /F /TR "$ps $Root\deploy\run-web.ps1" | Out-Null
schtasks /Create /TN 'LabWorkspace-Backup' /SC DAILY /ST 02:30 /RU SYSTEM /RL HIGHEST /F /TR "$ps $Root\deploy\backup.ps1" | Out-Null

# ---------- 6. 防火墙：只放行 Web 端口给单位内网与 WireGuard 内网 ----------
$rule = 'LabWorkspace-Web-In-TCP-3000'
$remote = @('10.129.0.0/16', '192.168.7.0/24')
$desc = '实验室工作台网页（3000）：仅放行单位内网 10.129.0.0/16 与 WireGuard 内网。应用自身有登录鉴权；数据库与分析服务只监听本机，无需放行。'
if (Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue) {
  Set-NetFirewallRule -Name $rule -Enabled True -RemoteAddress $remote -Description $desc | Out-Null
} else {
  New-NetFirewallRule -Name $rule -DisplayName "Lab Workspace 网页 ($WebPort)" -Direction Inbound -Protocol TCP -LocalPort $WebPort `
    -Action Allow -Profile Any -RemoteAddress $remote -Enabled True -Description $desc | Out-Null
}
"防火墙来源限制：$((Get-NetFirewallRule -Name $rule | Get-NetFirewallAddressFilter).RemoteAddress -join ', ')"

# ---------- 7. 启动并健康检查 ----------
Step '启动服务'
schtasks /Run /TN 'LabWorkspace-R' | Out-Null
schtasks /Run /TN 'LabWorkspace-Web' | Out-Null
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  try {
    $h = Invoke-RestMethod -UseBasicParsing -TimeoutSec 5 "http://127.0.0.1:$WebPort/api/v1/health"
    if ($h.status -eq 'ok') { $ok = $true; break }
  } catch {}
}
if (-not $ok) { throw "健康检查未通过，请查看 $Logs\web.log 与 $Logs\r-engine.log" }
Step "安装完成：http://<本机地址>:$WebPort  （数据库、分析服务均正常）"
