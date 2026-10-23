# 测试期间保护指定打印机：暂停 / 清空队列 / 恢复
#
# 只作用于 -PrinterName 精确匹配的这一台。早先版本对 Pause/Resume 用「所有
# 实体打印机」（按端口名过滤掉 PORTPROMPT/Kingsoft/SHRFAX 这类虚拟端口），
# Purge 更是完全没过滤、直接对 Get-CimInstance Win32_Printer 返回的每一台
# 调 CancelAllJobs——这台机是实验室共享设备，上面还挂着 HP 激光等其它人在用
# 的打印机，这套逻辑本来只是 Task 3 探查期间自己用的诊断夹具，被 Task 8
# 做成公用自检工具后，等于每次自检都会暂停/清空/恢复全实验室的打印机，把
# 别人排队的作业静默取消掉。现在必须按名字精确匹配到一台，其余打印机纹丝不动。
#
# Win32_Printer 的 Pause / Resume / CancelAllJobs 失败时不一定抛异常，成败首先
# 体现在返回对象的 ReturnValue 里（0 = 成功），必须逐条检查——否则失败会被
# Out-Null 悄悄吞掉，只看退出码的调用方会把失败误判为成功。
#
# 同时 CIM/WMI 调用本身也可能直接抛出未捕获异常（如传输层错误），必须逐台
# try/catch 隔离：一台打印机的异常绝不能连累同一循环里的其它台——尤其是
# Resume，一台恢复失败不能让后面几台连恢复的机会都没有。
#
# 不用 -Filter "Name='...'" 拼接 WQL 字符串去查询打印机：打印机名可能含
# 单引号（这台机上的打印机名已经有空格、括号、中文），拼出畸形查询会直接
# 抛异常；改为先取全量列表，再用 Where-Object 按名字精确比对，从根上消除
# 这个注入/拼接风险。
#
# Pause 分支不能只看「调用 Pause 没报错」就算成功——WMI 调用可能返回
# ReturnValue=0 但打印机其实没有真的进入暂停状态（这个项目已经在
# printer.status() 上栽过一次同类的坑：只看调用是否报错，不代表真实生效）。
# 必须在 Pause 之后回读一次打印机的暂停位确认，目标为空同样按失败处理——
# 否则调用方（selfcheck.check_link）会把「其实没暂停」误判为「已暂停」，
# 继续往下发真实数据，可能打出实物标签。
param(
    [Parameter(Mandatory=$true)][ValidateSet('Pause','Purge','Resume')][string]$Action,
    [string]$PrinterName = 'Brady BBP12'
)
$ErrorActionPreference = 'SilentlyContinue'
$target = @(Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $PrinterName })

function Invoke-CheckedMethod {
    param($TargetPrinter, [string]$MethodName)
    try {
        $r = Invoke-CimMethod -InputObject $TargetPrinter -MethodName $MethodName -ErrorAction Stop
        [PSCustomObject]@{
            Name        = $TargetPrinter.Name
            ReturnValue = $r.ReturnValue
            Ok          = ($r.ReturnValue -eq 0)
            ErrorMsg    = $null
        }
    }
    catch {
        [PSCustomObject]@{
            Name        = $TargetPrinter.Name
            ReturnValue = $null
            Ok          = $false
            ErrorMsg    = $_.Exception.Message
        }
    }
}

function Format-FailureLine {
    param($F, [string]$Verb)
    if ($F.ErrorMsg) {
        "  $Verb 失败：$($F.Name)（异常：$($F.ErrorMsg)）"
    } else {
        "  $Verb 失败：$($F.Name)（ReturnValue=$($F.ReturnValue)）"
    }
}

if ($target.Count -eq 0) {
    "找不到名为「$PrinterName」的打印机，$Action 未作用于任何打印机"
    exit 1
}

switch ($Action) {
  'Pause' {
      $results = @($target | ForEach-Object { Invoke-CheckedMethod -TargetPrinter $_ -MethodName 'Pause' })
      $failed  = @($results | Where-Object { -not $_.Ok })
      Start-Sleep -Seconds 1
      # 回读确认真的进入暂停态，不能只信 ReturnValue——这是本项目反复出现过的
      # 同一类假绿灯：唯一危险的方向（不暂停就继续往下发数据）必须有真信号回读。
      $notPaused = @(Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $PrinterName -and (($_.PrinterState -band 1) -eq 0) })
      $okCount = $target.Count - $notPaused.Count
      "已暂停 $okCount / $($target.Count) 台（目标：$PrinterName）"
      foreach ($f in $failed) { Format-FailureLine -F $f -Verb '暂停' }
      foreach ($b in $notPaused) { "  未进入暂停态：$($b.Name)" }
      if ($failed.Count -gt 0 -or $notPaused.Count -gt 0) { exit 1 } else { exit 0 }
  }
  'Purge'  {
      $results = @($target | ForEach-Object { Invoke-CheckedMethod -TargetPrinter $_ -MethodName 'CancelAllJobs' })
      $failed = @($results | Where-Object { -not $_.Ok })
      Start-Sleep -Seconds 2
      # 残留作业只统计目标打印机自己队列里的——Win32_PrintJob.Name 的格式是
      # "<打印机名>,<作业号>"，用正则按目标名前缀匹配，不能直接数全局作业总数：
      # 这台机是共享设备，别的打印机上随时可能有别人正常排队的作业，那些不该
      # 被算作「清空失败」。[regex]::Escape 防止打印机名里出现的圆括号等字符
      # 被当成正则元字符（这台机上真实存在带圆括号的打印机名）。
      $namePrefix = [regex]::Escape($PrinterName) + ','
      $remaining = @(Get-CimInstance Win32_PrintJob | Where-Object { $_.Name -match "^$namePrefix" })
      "已清空队列（目标：$PrinterName），残留作业 = " + $remaining.Count
      foreach ($f in $failed) { Format-FailureLine -F $f -Verb '清空' }
      if ($failed.Count -gt 0 -or $remaining.Count -gt 0) { exit 1 } else { exit 0 }
  }
  'Resume' {
      $results = @($target | ForEach-Object { Invoke-CheckedMethod -TargetPrinter $_ -MethodName 'Resume' })
      $failed = @($results | Where-Object { -not $_.Ok })
      Start-Sleep -Seconds 1
      $bad = @(Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $PrinterName -and (($_.PrinterState -band 1) -eq 1) })
      "已恢复（目标：$PrinterName）；仍处暂停的打印机数 = $($bad.Count)"
      foreach ($f in $failed) { Format-FailureLine -F $f -Verb '恢复' }
      foreach ($b in $bad) { "  仍处暂停：$($b.Name)" }
      if ($failed.Count -gt 0 -or $bad.Count -gt 0) { exit 1 } else { exit 0 }
  }
}
