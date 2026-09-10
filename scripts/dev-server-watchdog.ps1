<#
.SYNOPSIS
  로컬 Next.js dev 서버 감시 후 죽어 있으면 다시 띄우는 워치독.

.DESCRIPTION
  판단 기준은 "포트 3000이 응답하냐"가 아니라 **이 레포의 dev 서버 프로세스가 몇 개냐**다.
  dev 서버 두 개가 같은 .next 를 공유하면 서로 빌드 산출물을 덮어써서
  (Cannot find module './5611.js', app-paths-manifest.json ENOENT,
   Expected clientReferenceManifest to be defined) 500이 쏟아지기 때문.

    0개 → 새로 띄운다
    1개 → 그 프로세스가 잡은 포트로 헬스체크. 응답 없으면 죽이고 다시 띄운다
    2개 이상 → 충돌. 가장 최근에 뜬 것만 남기고 나머지를 정리한다
               (사용자가 직접 띄운 게 보통 최신이라 그쪽을 살린다)

  탐지는 포트(Get-NetTCPConnection)를 1차 기준으로 삼고, 레포 소속 여부만 WMI 커맨드라인으로
  확인한다. WMI 조회가 간헐적으로 빈 값을 주는데, 그걸 "서버 없음"으로 오판하면 두 번째 서버를
  띄워서 바로 그 500 사태가 나기 때문에 **확인 불가한 프로세스는 살아있는 것으로 간주**한다
  (놓치면 최대 한 주기 늦게 복구될 뿐, 중복 기동보다 훨씬 안전).

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
  # Next 가 3000이 막히면 3001, 3002... 로 밀리므로 이 범위를 훑는다
  [int]$PortScanEnd = 3010,
  # 헬스체크 1회 타임아웃(초). dev 서버는 첫 요청에서 컴파일하느라 느릴 수 있어 넉넉히.
  [int]$TimeoutSec = 15,
  # 재시작 판단 전 재시도 횟수
  [int]$Retries = 3,
  # 재시작 후 기동을 기다리는 최대 시간(초)
  [int]$StartupWaitSec = 180,
  # 죽어 있어도 띄우거나 정리하지 않고 상태만 확인
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogDir      = Join-Path $env:LOCALAPPDATA 'helpdesk-x-watchdog'
$LogFile     = Join-Path $LogDir 'watchdog.log'
$DevLogFile  = Join-Path $LogDir 'dev-server.log'
# 이 레포의 dev 서버를 식별하는 표식 (커맨드라인에 레포 경로가 그대로 박힌다)
$ServerMark  = Join-Path $ProjectRoot 'node_modules\next'

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

function Get-CommandLineSafe {
  # WMI 가 흔들리면 $null 을 돌려준다. 두 번까지 시도.
  param([int]$ProcessId)
  for ($i = 0; $i -lt 2; $i++) {
    try {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
      if ($p -and $p.CommandLine) { return $p.CommandLine }
    } catch { }
    Start-Sleep -Milliseconds 300
  }
  return $null
}

function Get-DevServers {
  # 3000~PortScanEnd 를 리스닝 중인 node 프로세스를 모은다.
  # Belongs: $true  = 이 레포 서버로 확인됨 (정리 대상이 될 수 있음)
  #          $null  = 커맨드라인 확인 실패 → 살아있는 것으로 간주하되 건드리지 않음
  #          $false = 다른 프로젝트/프로그램 → 무시
  $result = @()
  $conns = @()
  try {
    $conns = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
               Where-Object { $_.LocalPort -ge $Port -and $_.LocalPort -le $PortScanEnd })
  } catch { }

  foreach ($processId in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ProcessName -ne 'node') { continue }

    $cmd = Get-CommandLineSafe -ProcessId $processId
    $belongs = $null
    if ($cmd) {
      if ($cmd.IndexOf($ServerMark, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $belongs = $true }
      else { $belongs = $false }
    }
    if ($belongs -eq $false) { continue }

    $port = ($conns | Where-Object { $_.OwningProcess -eq $processId } |
             Select-Object -First 1 -ExpandProperty LocalPort)
    $started = $null
    try { $started = $proc.StartTime } catch { }

    $result += [PSCustomObject]@{
      ProcessId = $processId
      Port      = $port
      Started   = $started
      Verified  = ($belongs -eq $true)
    }
  }
  return @($result | Sort-Object Started)
}

function Test-Health {
  # 'ok'       - 정상 응답 (인증 리다이렉트/404 포함. 서버가 요청을 처리하고 있음)
  # 'error5xx' - 떠 있긴 한데 500을 뱉음 (보통 .next 빌드 캐시가 깨진 상태)
  # 'dead'     - 연결 자체가 안 됨
  param([int]$HealthPort, [int]$Attempts = 1, [int]$DelaySec = 5)
  $url = "http://localhost:$HealthPort/api/health"
  $sawServerError = $false
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $TimeoutSec | Out-Null
      return 'ok'
    } catch {
      $res = $_.Exception.Response
      if ($res) {
        $code = [int]$res.StatusCode
        # 4xx(인증/404 등)는 서버가 멀쩡히 도는 것. 5xx 만 고장으로 본다.
        if ($code -lt 500) { return 'ok' }
        $sawServerError = $true
      }
      # 연결 거부 / 타임아웃 → 다음 시도
    }
    if ($i -lt $Attempts) { Start-Sleep -Seconds $DelaySec }
  }
  if ($sawServerError) { return 'error5xx' }
  return 'dead'
}

function Test-StaleBuildCache {
  # dev 서버 로그 끝부분에 "빌드 캐시가 깨졌다"는 특유의 흔적이 있는지 본다.
  # 서버 두 개가 같은 .next 를 덮어썼거나 컴파일이 중간에 끊겼을 때 나오는 패턴.
  if (-not (Test-Path $DevLogFile)) { return $false }
  $patterns = @(
    "MODULE_NOT_FOUND",
    "Cannot find module './",
    "clientReferenceManifest",
    "app-paths-manifest.json"
  )
  $tail = Get-Content $DevLogFile -Tail 200 -ErrorAction SilentlyContinue
  foreach ($line in $tail) {
    foreach ($pat in $patterns) {
      if ($line -and $line.Contains($pat)) { return $true }
    }
  }
  return $false
}

function Clear-NextCache {
  $nextDir = Join-Path $ProjectRoot '.next'
  if (-not (Test-Path $nextDir)) { return }
  try {
    Remove-Item $nextDir -Recurse -Force -ErrorAction Stop
    Write-Log ".next 빌드 캐시 삭제 (다음 기동에서 새로 빌드)" 'WARN'
  } catch {
    Write-Log (".next 삭제 실패: {0}" -f $_.Exception.Message) 'WARN'
  }
}

function Stop-DevServer {
  param($Server, [string]$Why)
  if (-not $Server.Verified) {
    Write-Log ("PID {0} 는 이 레포 서버인지 확인 못해서 건드리지 않음" -f $Server.ProcessId) 'WARN'
    return
  }
  try {
    Stop-Process -Id $Server.ProcessId -Force -ErrorAction Stop
    Write-Log ("dev 서버 종료 (PID {0}, 포트 {1}): {2}" -f $Server.ProcessId, $Server.Port, $Why) 'WARN'
    Start-Sleep -Seconds 2
  } catch {
    Write-Log ("dev 서버 종료 실패 (PID {0}): {1}" -f $Server.ProcessId, $_.Exception.Message) 'WARN'
  }
}

function Start-DevServer {
  Write-Log "dev 서버 기동: npm run dev ($ProjectRoot)"

  # 앱이 로그를 많이 뱉어서 dev-server.log 가 계속 커진다. 20MB 넘으면 한 세대만 남기고 교체.
  if (Test-Path $DevLogFile) {
    if ((Get-Item $DevLogFile).Length -gt 20MB) {
      Move-Item -Path $DevLogFile -Destination "$DevLogFile.1" -Force -ErrorAction SilentlyContinue
      Write-Log "dev-server.log 20MB 초과 - .1 로 교체"
    }
  }

  $header = "`r`n===== {0} watchdog restart =====" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  Add-Content -Path $DevLogFile -Value $header -Encoding utf8

  $cmdLine = '/c npm run dev >> "' + $DevLogFile + '" 2>&1'
  Start-Process -FilePath 'cmd.exe' `
                -ArgumentList $cmdLine `
                -WorkingDirectory $ProjectRoot `
                -WindowStyle Hidden

  # 기동 대기: 5초 간격으로 최대 StartupWaitSec 만큼 확인
  $deadline = (Get-Date).AddSeconds($StartupWaitSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $state = Test-Health -HealthPort $Port -Attempts 1
    if ($state -eq 'ok') {
      Write-Log ("기동 완료 (포트 {0})" -f $Port)
      return $true
    }
    if ($state -eq 'error5xx') {
      Write-Log ("기동은 됐는데 500 응답. {0} 확인 필요" -f $DevLogFile) 'ERROR'
      return $false
    }
  }
  Write-Log ("기동 후 {0} 초 안에 응답 없음. {1} 확인 필요" -f $StartupWaitSec, $DevLogFile) 'ERROR'
  return $false
}

# ---- main ----------------------------------------------------------------

# @() 필수 - 결과가 1개면 PowerShell 이 배열을 풀어 PSCustomObject 하나로 돌려주는데,
# 그 타입엔 .Count 가 없어서 아래 분기가 전부 빗나가고 "서버 없음"으로 오판한다.
$servers = @(Get-DevServers)

# 2개 이상 = .next 를 서로 덮어써서 500이 나는 상황. 최신 것만 남긴다.
if ($servers.Count -ge 2) {
  $keep = $servers[-1]
  $ports = ($servers | ForEach-Object { $_.Port }) -join ', '
  Write-Log ("dev 서버 {0}개 동시 실행 감지 (포트 {1}) - .next 충돌. 최신 PID {2} 만 유지" -f $servers.Count, $ports, $keep.ProcessId) 'WARN'
  if ($CheckOnly) {
    Write-Log "CheckOnly 모드라 정리하지 않음"
    Trim-Log
    exit 1
  }
  foreach ($s in $servers[0..($servers.Count - 2)]) {
    Stop-DevServer -Server $s -Why "중복 실행 정리"
  }
  Trim-Log
  exit 0
}

# 1개 = 정상 후보. 실제로 응답하는지만 본다.
if ($servers.Count -eq 1) {
  $server = $servers[0]

  $state = Test-Health -HealthPort $server.Port -Attempts $Retries

  if ($state -eq 'ok') {
    if ($server.Port -ne $Port) {
      Write-Log ("정상 (PID {0}, 포트 {1} - 직접 띄운 서버로 보여 건드리지 않음)" -f $server.ProcessId, $server.Port)
    } else {
      Write-Log ("정상 (PID {0}, 포트 {1})" -f $server.ProcessId, $server.Port)
    }
    Trim-Log
    exit 0
  }

  $cleanNext = $false

  if ($state -eq 'error5xx') {
    # 500 이라고 무조건 재시작하면 코드 오류로 500 나는 상황에서 서버를 계속 걷어차게 된다.
    # 빌드 캐시가 깨진 흔적이 로그에 있을 때만 .next 를 지우고 재기동한다.
    if (-not (Test-StaleBuildCache)) {
      Write-Log ("포트 {0} 이 500 을 뱉지만 빌드 캐시 문제로 보이지 않음 - 코드 오류일 수 있어 손대지 않음" -f $server.Port) 'WARN'
      Trim-Log
      exit 1
    }
    Write-Log ("포트 {0} 500 + 빌드 캐시 깨진 흔적 - .next 지우고 재기동" -f $server.Port) 'WARN'
    $cleanNext = $true
  } else {
    Write-Log ("프로세스는 살아있는데 포트 {0} 응답 없음 - {1} 회 시도 실패" -f $server.Port, $Retries) 'WARN'
  }

  if ($CheckOnly) {
    Write-Log "CheckOnly 모드라 재시작하지 않음"
    Trim-Log
    exit 1
  }
  Stop-DevServer -Server $server -Why $(if ($cleanNext) { "빌드 캐시 손상" } else { "응답 없음" })
  # 확인 못한 프로세스면 죽이지 않았을 테니, 아직 살아있으면 새로 띄우지 않는다
  if (Get-Process -Id $server.ProcessId -ErrorAction SilentlyContinue) {
    Trim-Log
    exit 1
  }
  if ($cleanNext) { Clear-NextCache }
  $ok = Start-DevServer
  Trim-Log
  if ($ok) { exit 0 } else { exit 1 }
}

# 0개 = 죽어 있다. 새로 띄운다.
Write-Log "dev 서버 없음" 'WARN'
if ($CheckOnly) {
  Write-Log "CheckOnly 모드라 재시작하지 않음"
  Trim-Log
  exit 1
}
$ok = Start-DevServer
Trim-Log
if ($ok) { exit 0 } else { exit 1 }
