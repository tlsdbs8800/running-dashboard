# 가민 러닝 트래커 Windows 자동 설치 스크립트
# PowerShell을 관리자 권한으로 실행 후: .\setup-windows.ps1

Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force

Write-Host "=== 러닝 트래커 Windows 설치 시작 ===" -ForegroundColor Cyan

# 1. winget으로 필수 프로그램 설치
Write-Host "`n[1/5] Git, Python, Node.js 설치 중..." -ForegroundColor Yellow

$installs = @(
    @{ id = "Git.Git";           name = "Git" },
    @{ id = "Python.Python.3.11"; name = "Python" },
    @{ id = "OpenJS.NodeJS.LTS"; name = "Node.js" }
)
foreach ($pkg in $installs) {
    $check = winget list --id $pkg.id 2>$null
    if ($check -match $pkg.id) {
        Write-Host "  ✓ $($pkg.name) 이미 설치됨"
    } else {
        Write-Host "  설치 중: $($pkg.name)..."
        winget install --id $pkg.id -e --silent --accept-package-agreements --accept-source-agreements
    }
}

# PATH 새로고침
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("PATH","User")

# 2. 프로젝트 클론
Write-Host "`n[2/5] 프로젝트 다운로드 중..." -ForegroundColor Yellow
$projectDir = "$env:USERPROFILE\running"
if (Test-Path $projectDir) {
    Write-Host "  폴더 이미 존재 — git pull 실행"
    Set-Location $projectDir
    git pull origin main
} else {
    git clone https://github.com/tlsdbs8800/running-dashboard $projectDir
    Set-Location $projectDir
}

# 3. Python 패키지 설치
Write-Host "`n[3/5] Python 패키지 설치 중..." -ForegroundColor Yellow
python -m pip install --upgrade pip --quiet
python -m pip install garminconnect --quiet
Write-Host "  ✓ garminconnect 설치 완료"

# 4. Node.js 패키지 설치
Write-Host "`n[4/5] Node.js 패키지 설치 중..." -ForegroundColor Yellow
npm install --silent
Write-Host "  ✓ npm install 완료"

# 5. .env 파일 생성
Write-Host "`n[5/5] 계정 설정..." -ForegroundColor Yellow
$envFile = "$projectDir\.env"
if (Test-Path $envFile) {
    Write-Host "  ✓ .env 이미 존재 — 건너뜀"
} else {
    $email    = Read-Host "  Garmin 이메일"
    $password = Read-Host "  Garmin 비밀번호"
    @"
GARMIN_EMAIL=$email
GARMIN_PASSWORD=$password
"@ | Set-Content $envFile -Encoding UTF8
    Write-Host "  ✓ .env 생성 완료"
}

# 6. 첫 sync 실행 (토큰 생성)
Write-Host "`n첫 번째 sync 실행 중 (OAuth 토큰 생성)..." -ForegroundColor Yellow
python sync.py --user yunho
Write-Host "  ✓ 완료"

# 7. Windows 작업 스케줄러 등록 (매일 오후 8시)
Write-Host "`n작업 스케줄러 등록 중 (매일 오후 8시)..." -ForegroundColor Yellow

$taskName  = "GarminRunningSyncDaily"
$taskExist = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($taskExist) {
    Write-Host "  ✓ 작업 이미 존재 — 업데이트"
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$pythonPath = (Get-Command python -ErrorAction SilentlyContinue).Source
$nodePath   = (Get-Command node   -ErrorAction SilentlyContinue).Source

# 일반 sync 스크립트 (월~토)
$syncScript = @"
cd /d "$projectDir" && git pull --rebase origin main && python sync.py && node generate-dashboard.js && git add data\ dashboard.html && git commit -m "sync: %date% %time% 자동 갱신" && git push
"@
$syncBat = "$projectDir\run-sync.bat"
@"
@echo off
cd /d "$projectDir"
git pull --rebase origin main
python sync.py
node generate-daily-report.js morning
node generate-dashboard.js
git add data\ dashboard.html
git commit -m "[morning] auto" 2>nul
git push
timeout /t 30 /nobreak
rundll32.exe powrprof.dll,SetSuspendState 0,1,0
"@ | Set-Content $syncBat -Encoding UTF8

# 저녁 sync (런 분석)
$eveningBat = "$projectDir\run-sync-evening.bat"
@"
@echo off
cd /d "$projectDir"
git pull --rebase origin main
python sync.py
node generate-daily-report.js evening
node generate-dashboard.js
git add data\ dashboard.html
git commit -m "[evening] auto" 2>nul
git push
timeout /t 30 /nobreak
rundll32.exe powrprof.dll,SetSuspendState 0,1,0
"@ | Set-Content $eveningBat -Encoding UTF8

# 일요일 저녁 (런 분석 + 주간 플랜)
$sundayBat = "$projectDir\run-sync-sunday.bat"
@"
@echo off
cd /d "$projectDir"
git pull --rebase origin main
python sync.py
node generate-daily-report.js evening
node generate-dashboard.js
node generate-plan.js
git add data\ dashboard.html
git commit -m "[sunday] auto" 2>nul
git push
timeout /t 30 /nobreak
rundll32.exe powrprof.dll,SetSuspendState 0,1,0
"@ | Set-Content $sundayBat -Encoding UTF8

# 작업 등록
$triggerMorning    = New-ScheduledTaskTrigger -Daily -At "07:00"
$triggerEvening    = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday,Saturday -At "19:00"
$triggerSunEvening = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "19:00"

$settings  = New-ScheduledTaskSettingsSet -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest

Register-ScheduledTask -TaskName "${taskName}_Morning"    -Trigger $triggerMorning    -Action (New-ScheduledTaskAction -Execute $syncBat)     -Settings $settings -Principal $principal -Force | Out-Null
Register-ScheduledTask -TaskName "${taskName}_Evening"    -Trigger $triggerEvening    -Action (New-ScheduledTaskAction -Execute $eveningBat)   -Settings $settings -Principal $principal -Force | Out-Null
Register-ScheduledTask -TaskName "${taskName}_SunEvening" -Trigger $triggerSunEvening -Action (New-ScheduledTaskAction -Execute $sundayBat)    -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "  ✓ 작업 스케줄러 등록 완료 (오전 7시 / 오후 7시)" -ForegroundColor Green

Write-Host "`n=== 설치 완료 ===" -ForegroundColor Cyan
Write-Host "  대시보드: https://tlsdbs8800.github.io/running-dashboard/dashboard.html"
Write-Host "  오전 7시: 컨디션 체크 + 오늘 훈련 추천"
Write-Host "  오후 7시: 런 분석 + 내일 예고"
Write-Host "  절전 모드에서도 자동으로 깨어나 실행됩니다`n"
