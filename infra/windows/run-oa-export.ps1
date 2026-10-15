# 计划任务单次执行入口；Node 只输出脱敏的状态，不输出 OA 原始异常。
$ErrorActionPreference = 'Continue'
$Root = 'C:\lab-workspace'
$Node = "$Root\node\node.exe"
$Script = "$Root\automation\oa-export\src\cli.mjs"
$EnvFile = "$Root\config\oa.env"
$Log = 'E:\lab-workspace\logs\oa-export.log'
cmd /c "`"$Node`" `"$Script`" --env `"$EnvFile`" >> `"$Log`" 2>&1"
exit $LASTEXITCODE
