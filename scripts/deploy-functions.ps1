# Deploy Firebase Functions
# Jalankan dari root monorepo: .\scripts\deploy-functions.ps1
# Opsional, pilih project: .\scripts\deploy-functions.ps1 -Project nc-manager-staging

param(
    [string]$Project = "nc-manager"
)

$Root = Split-Path $PSScriptRoot -Parent
$DeployDir = "$Root\functions-deploy"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

Write-Host "`n== 1. Build semua package ==" -ForegroundColor Cyan
pnpm --filter "@nc-manager/shared-constants" --filter "@nc-manager/shared-types" --filter "@nc-manager/validation" build
if ($LASTEXITCODE -ne 0) { Write-Error "Build packages gagal"; exit 1 }

pnpm --filter "@nc-manager/functions" build
if ($LASTEXITCODE -ne 0) { Write-Error "Build functions gagal"; exit 1 }

Write-Host "`n== 2. Buat deployment bundle ==" -ForegroundColor Cyan

if (Test-Path $DeployDir) { Remove-Item -Recurse -Force $DeployDir }
New-Item -ItemType Directory -Force "$DeployDir\packages" | Out-Null

# Salin hasil kompilasi functions
Copy-Item -Recurse "$Root\functions\lib" "$DeployDir\lib"

# Salin setiap workspace package (hanya dist + package.json minimal)
$workspacePkgs = @{
    "shared-constants" = '{"name":"@nc-manager/shared-constants","version":"0.0.1","main":"./dist/index.js","exports":{".":{"require":"./dist/index.js","import":"./dist/index.mjs"}}}'
    "shared-types"     = '{"name":"@nc-manager/shared-types","version":"0.0.1","main":"./dist/index.js","exports":{".":{"require":"./dist/index.js","import":"./dist/index.mjs"}}}'
    "validation"       = '{"name":"@nc-manager/validation","version":"0.0.1","main":"./dist/index.js","exports":{".":{"require":"./dist/index.js","import":"./dist/index.mjs"}},"dependencies":{"zod":"^3.25.23"}}'
}
foreach ($pkg in $workspacePkgs.Keys) {
    $dst = "$DeployDir\packages\$pkg"
    New-Item -ItemType Directory -Force $dst | Out-Null
    Copy-Item -Recurse "$Root\packages\$pkg\dist" "$dst\dist"
    [System.IO.File]::WriteAllText("$dst\package.json", $workspacePkgs[$pkg], $utf8NoBom)
}

# Buat package.json deploy (tanpa workspace:*)
@'
{
  "name": "nc-manager-functions",
  "version": "1.0.0",
  "private": true,
  "main": "lib/index.js",
  "engines": { "node": "20" },
  "dependencies": {
    "@nc-manager/shared-constants": "file:./packages/shared-constants",
    "@nc-manager/shared-types": "file:./packages/shared-types",
    "@nc-manager/validation": "file:./packages/validation",
    "firebase-admin": "^13.4.0",
    "firebase-functions": "^6.6.0",
    "zod": "^3.25.23"
  }
}
'@ | ForEach-Object { [System.IO.File]::WriteAllText("$DeployDir\package.json", $_, $utf8NoBom) }

Write-Host "`n== 3. Install lokal (untuk pengecekan Firebase CLI) ==" -ForegroundColor Cyan
Push-Location $DeployDir
npm install --ignore-scripts --silent
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Error "npm install gagal"; exit 1 }
Pop-Location

Write-Host "`n== 4. Deploy ke Firebase ($Project) ==" -ForegroundColor Cyan

# Ganti sumber sementara ke functions-deploy
$firebaseJson = Get-Content "$Root\firebase.json" -Raw
$patched = $firebaseJson -replace '"source": "functions"', '"source": "functions-deploy"'
Set-Content "$Root\firebase.json" $patched -Encoding utf8

try {
    npx firebase deploy --only functions --project $Project
    $exitCode = $LASTEXITCODE
} finally {
    # Kembalikan firebase.json ke semula
    Set-Content "$Root\firebase.json" $firebaseJson -Encoding utf8
}

if ($exitCode -gt 2) {
    Write-Error "Deploy gagal (exit $exitCode)"
    exit $exitCode
}

Write-Host "`n== Selesai! Functions berhasil di-deploy ke $Project ==" -ForegroundColor Green
