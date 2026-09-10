<#
.SYNOPSIS
  워치독이 숨김으로 띄운 dev 서버의 출력을 실시간으로 따라 본다. (tmux attach 대용, 읽기 전용)

.DESCRIPTION
  워치독 서버는 창 없이 떠 있고 stdout/stderr 가 전부
  %LOCALAPPDATA%\helpdesk-x-watchdog\dev-server.log 로 들어간다. 이걸 tail -f 처럼 따라간다.
  Ctrl+C 는 보기만 멈춘다 (= detach). 서버는 계속 돈다.

  색: 빨강 = 에러/500, 노랑 = 재기동/경고, 초록 = 준비 완료

.EXAMPLE
  npm run logs                      # 최근 50줄 + 실시간
  npm run logs -- -Quiet            # [stt-batch] 반복 로그 숨김
  npm run logs -- -Errors           # 에러만
  npm run logs -- -Watchdog         # 워치독 판단 기록(재기동/정리 이력)
  npm run logs -- -Tail 300 -NoFollow
#>
[CmdletBinding()]
param(
  # 처음에 보여줄 줄 수
  [int]$Tail = 50,
  # 에러/500 관련 줄만
  [switch]$Errors,
  # [stt-batch] 반복 스팸 숨김
  [switch]$Quiet,
  # dev 서버 출력 대신 워치독 자체 로그
  [switch]$Watchdog,
  # 따라가지 않고 한 번 출력 후 종료
  [switch]$NoFollow
)

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$LogDir = Join-Path $env:LOCALAPPDATA 'helpdesk-x-watchdog'
$file   = if ($Watchdog) { Join-Path $LogDir 'watchdog.log' } else { Join-Path $LogDir 'dev-server.log' }

if (-not (Test-Path $file)) {
  Write-Host "로그 파일이 없음: $file" -ForegroundColor Red
  Write-Host "워치독이 아직 서버를 띄운 적이 없거나, 직접 npm run dev 한 서버라면 그 터미널에서 봐야 합니다."
  exit 1
}

$errorPattern = '⨯|Error|MODULE_NOT_FOUND|Cannot find module| 5\d\d in |\[ERROR\]'
$warnPattern  = 'watchdog restart|\[WARN\]|⚠'
$okPattern    = 'Ready in|기동 완료|✓ Compiled'
$noisePattern = '\[stt-batch\] (scheduled run skipped|harvest skipped)'

# stt-batch 반복 로그는 "TypeError fetch failed" 를 달고 몇 초마다 찍혀서
# 에러 필터에 전부 걸린다. 에러만 볼 때는 자동으로 숨긴다.
$hideNoise = $Quiet -or $Errors

$mode = @()
if ($Errors)    { $mode += '에러만' }
if ($hideNoise) { $mode += 'stt-batch 반복 숨김' }
$modeText = if ($mode.Count) { ' [' + ($mode -join ', ') + ']' } else { '' }
Write-Host ("── {0}{1}" -f $file, $modeText) -ForegroundColor DarkGray
if (-not $NoFollow) { Write-Host "── Ctrl+C 로 보기 종료 (서버는 계속 돕니다)" -ForegroundColor DarkGray }

$params = @{ Path = $file; Tail = $Tail; Encoding = 'UTF8' }
if (-not $NoFollow) { $params.Wait = $true }

Get-Content @params | ForEach-Object {
  $line = $_
  if ($hideNoise -and $line -match $noisePattern) { return }
  if ($Errors -and $line -notmatch $errorPattern) { return }

  if     ($line -match $errorPattern) { Write-Host $line -ForegroundColor Red }
  elseif ($line -match $warnPattern)  { Write-Host $line -ForegroundColor Yellow }
  elseif ($line -match $okPattern)    { Write-Host $line -ForegroundColor Green }
  else                                { Write-Host $line }
}
