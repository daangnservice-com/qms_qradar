<#
.SYNOPSIS
  로컬 Next.js dev 서버(localhost:3000) 감시 후 죽어 있으면 다시 띄우는 워치독.

.DESCRIPTION
  1) http://localhost:<Port>/api/health 로 응답 여부를 확인한다.
     (미들웨어가 /login 으로 리다이렉트하거나 4xx를 주더라도 "HTTP 응답이 왔다" = 살아있음으로 본다.
      TCP 연결 자체가 안 될 때만 죽은 것으로 판단)
  2) 죽었으면 3000 포트를 잡고 있는 좀비 프로세스만 정리하고 `npm run dev` 를 백그라운드로 다시 띄운다.
  3) 기동 후 다시 확인해서 성공/실패를 로그에 남긴다.

  로그: %LOCALAPPDATA%\helpdesk-x-watchdog\
    watchdog.log    - 워치독 자체 기록
    dev-server.log  - npm run dev 의 stdout/stderr

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-server-watchdog.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-server-watchdog.ps1 -CheckOnly
#>
[CmdletBinding()]
param(
  [int]$Port = 3000,
  # 헬스체크 1회 타임아웃(초). dev 서버는 첫 요청에서 컴파일하느라 느릴 수 있어 넉넉히.
  [int]$TimeoutSec = 15,
  # 재시작 판단 전 재시도 횟수
  [int]$Retries = 3,
  # 재시작 후 기동을 기다리는 최대 시간(초)
  [int]$StartupWaitSec = 180,
  # 죽어 있어도 띄우지 않고 상태만 확인
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogDir      = Join-Path $env:LOCALAPPDATA 'helpdesk-x-watchdog'
$LogFile     = Join-Path $LogDir 'watchdog.log'
$DevLogFile  = Join-Path $LogDir 'dev-server.log'
$HealthUrl   = "http://localhost:$Port/api/health"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  Add-Content -Path $LogFile -Value $line -Encoding utf8
  Write-Host $line
}

function Trim-Log {
  # 로그가 무한정 커지지 않도록 최근 1000줄 넘으면 800줄로 잘라둔다
  if (-not (Test-Path $LogFile)) { return }
  $lines = @(Get-Content $LogFile)
  if ($lines.Count -gt 1000) {
    $lines | Select-Object -Last 800 | Set-Content -Path $LogFile -Encoding utf8
  }
}

function Test-Health {
  param([int]$Attempts = 1, [int]$DelaySec = 5)
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec $TimeoutSec | Out-Null
      return $true
    } catch {
      # HTTP 상태 코드가 돌아왔다면(401/403/404/5xx 등) 서버는 살아있는 것
      if ($_.Exception.Response) { return $true }
      # 연결 거부 / 타임아웃 → 다음 시도
    }
    if ($i -lt $Attempts) { Start-Sleep -Seconds $DelaySec }
  }
  return $false
}

function Get-PortOwnerPid {
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($conn) { return $conn.OwningProcess }
  } catch { }
  return $null
}

function Stop-StaleServer {
  # 3000 포트를 잡고 있는 프로세스만 정리한다. (다른 node 프로세스는 절대 건드리지 않음)
  $stalePid = Get-PortOwnerPid
  if (-not $stalePid) { return }
  try {
    $proc = Get-Process -Id $stalePid -ErrorAction Stop
    Write-Log ("포트 {0} 를 잡고 있지만 응답 없는 프로세스 종료: PID {1} ({2})" -f $Port, $stalePid, $proc.ProcessName) 'WARN'
    Stop-Process -Id $stalePid -Force -ErrorAction Stop
    Start-Sleep -Seconds 3
  } catch {
    Write-Log ("좀비 프로세스 종료 실패 (PID {0}): {1}" -f $stalePid, $_.Exception.Message) 'WARN'
  }
}

function Start-DevServer {
  Write-Log "dev 서버 기동: npm run dev ($ProjectRoot)"
  $header = "`r`n===== {0} watchdog restart =====" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  Add-Content -Path $DevLogFile -Value $header -Encoding utf8

  $cmdLine = '/c npm run dev >> "' + $DevLogFile + '" 2>&1'
  Start-Process -FilePath 'cmd.exe' `
                -ArgumentList $cmdLine `
                -WorkingDirectory $ProjectRoot `
                -WindowStyle Hidden
}

# ---- main ----------------------------------------------------------------

if (Test-Health -Attempts $Retries) {
  Write-Log "정상 (응답 있음)"
  Trim-Log
  exit 0
}

Write-Log ("응답 없음 - {0} 회 시도 실패" -f $Retries) 'WARN'

if ($CheckOnly) {
  Write-Log "CheckOnly 모드라 재시작하지 않음"
  Trim-Log
  exit 1
}

Stop-StaleServer
Start-DevServer

# 기동 대기: 5초 간격으로 최대 StartupWaitSec 만큼 확인
$deadline = (Get-Date).AddSeconds($StartupWaitSec)
$up = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  if (Test-Health -Attempts 1) { $up = $true; break }
}

if ($up) {
  Write-Log "재시작 성공"
  Trim-Log
  exit 0
} else {
  Write-Log ("재시작 후에도 {0} 초 안에 응답 없음. {1} 확인 필요" -f $StartupWaitSec, $DevLogFile) 'ERROR'
  Trim-Log
  exit 1
}
