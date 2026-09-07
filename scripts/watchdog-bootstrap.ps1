<#
.SYNOPSIS
  로그인할 때 한 번 돌면서 워치독 환경을 스스로 복구하고 dev 서버를 띄운다.

.DESCRIPTION
  시작프로그램(shell:startup)에 등록해두고 쓴다. 하는 일:
    1) 창 없이 실행하는 래퍼 vbs 2개를 현재 스크립트 경로에 맞춰 재생성 (레포를 옮겨도 따라감)
    2) 예약 작업 helpdesk-x-dev-watchdog 이 없거나 옛 방식(.cmd)을 가리키면 3분 주기로 다시 등록
       (작업이 지워져도 다음 로그인 때 스스로 살아남)
    3) 시작프로그램 바로가기가 없으면 다시 생성
    4) 워치독을 한 번 실행해서 dev 서버가 죽어 있으면 바로 기동

  cmd.exe 로 직접 돌리면 3분마다 콘솔 창이 깜빡여서, wscript 래퍼(창 스타일 0)로 감쌌다.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watchdog-bootstrap.ps1
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'helpdesk-x-dev-watchdog',
  [int]$IntervalMinutes = 3
)

$ErrorActionPreference = 'Stop'

$BootstrapScript = $PSCommandPath
$WatchdogScript  = Join-Path $PSScriptRoot 'dev-server-watchdog.ps1'
$LogDir          = Join-Path $env:LOCALAPPDATA 'helpdesk-x-watchdog'
$LogFile         = Join-Path $LogDir 'watchdog.log'
$WatchdogVbs     = Join-Path $LogDir 'run-watchdog.vbs'
$BootstrapVbs    = Join-Path $LogDir 'run-bootstrap.vbs'
$LegacyCmd       = Join-Path $LogDir 'run-watchdog.cmd'
$ShortcutPath    = Join-Path ([Environment]::GetFolderPath('Startup')) 'helpdesk-x dev watchdog.lnk'

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $line = "{0} [{1}] (boot) {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  Add-Content -Path $LogFile -Value $line -Encoding utf8
  Write-Host $line
}

function Write-HiddenLauncher {
  # powershell 을 창 없이(스타일 0) 띄우고 끝날 때까지 기다리는 vbs 래퍼를 만든다.
  param([string]$VbsPath, [string]$TargetScript)
  $lines = @(
    "' helpdesk-x watchdog - run PowerShell with no console window",
    "Set sh = CreateObject(""WScript.Shell"")",
    "sh.Run ""powershell.exe -NoProfile -ExecutionPolicy Bypass -File """"$TargetScript"""""", 0, True"
  )
  [System.IO.File]::WriteAllText($VbsPath, ($lines -join "`r`n") + "`r`n", [System.Text.Encoding]::Default)
}

if (-not (Test-Path $WatchdogScript)) {
  Write-Log "워치독 스크립트를 찾을 수 없음: $WatchdogScript" 'ERROR'
  exit 1
}

# 1) 래퍼 재생성 - 레포 경로가 바뀌어도 이걸로 따라간다
Write-HiddenLauncher -VbsPath $WatchdogVbs  -TargetScript $WatchdogScript
Write-HiddenLauncher -VbsPath $BootstrapVbs -TargetScript $BootstrapScript
if (Test-Path $LegacyCmd) {
  Remove-Item $LegacyCmd -Force -ErrorAction SilentlyContinue
  Write-Log "콘솔 창이 뜨던 옛 런처(run-watchdog.cmd) 제거"
}

# 2) 예약 작업 점검 후 없거나 옛 방식이면 재등록
# schtasks 는 작업이 없으면 stderr 로 떠드는데, PS 5.1 은 그걸 종료 오류로 승격시킨다.
# 그래서 이 구간만 ErrorActionPreference 를 낮추고 종료 코드로 판단한다.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'

$taskInfo = & schtasks /Query /TN $TaskName /FO LIST /V 2>&1 | Out-String
$taskOk = ($LASTEXITCODE -eq 0) -and ($taskInfo -match [regex]::Escape($WatchdogVbs))

if ($taskOk) {
  Write-Log "예약 작업 정상"
} else {
  $trCommand = "wscript.exe $WatchdogVbs"
  & schtasks /Create /TN $TaskName /SC MINUTE /MO $IntervalMinutes /TR $trCommand /F 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Log "예약 작업 재등록 ($IntervalMinutes 분 주기, 창 없이 실행)" 'WARN'
  } else {
    Write-Log "예약 작업 재등록 실패 (schtasks exit $LASTEXITCODE)" 'ERROR'
  }
}

$ErrorActionPreference = $prevEap

# 3) 시작프로그램 바로가기 점검 (wscript 래퍼를 가리키게)
$needShortcut = $true
$shell = New-Object -ComObject WScript.Shell
if (Test-Path $ShortcutPath) {
  $existing = $shell.CreateShortcut($ShortcutPath)
  if ($existing.Arguments -match [regex]::Escape($BootstrapVbs)) { $needShortcut = $false }
}
if ($needShortcut) {
  $lnk = $shell.CreateShortcut($ShortcutPath)
  $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $lnk.Arguments = '"' + $BootstrapVbs + '"'
  $lnk.WorkingDirectory = $LogDir
  $lnk.WindowStyle = 7
  $lnk.Description = 'helpdesk-x dev server watchdog bootstrap (logon)'
  $lnk.Save()
  Write-Log "시작프로그램 바로가기 재생성" 'WARN'
}

# 4) 워치독 1회 실행 (죽어 있으면 여기서 dev 서버가 뜬다)
& $WatchdogScript
exit $LASTEXITCODE
