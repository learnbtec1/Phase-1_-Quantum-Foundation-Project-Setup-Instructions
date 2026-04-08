# Run from project root (where docker-compose.yml lives).
# Creates role eduverse + grants (see postgres_add_eduverse_role.sql) then schema grants on app DB.
param(
    [string]$SuperUser = "nexus",
    [string]$AppDatabase = "eduverse",
    # If set, do not run "docker compose up -d db" when db is stopped (fail with a clear message instead).
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root

function Test-DbServiceRunning {
    $id = docker compose ps -q db 2>$null
    if (-not $id) { return $false }
    $status = docker inspect -f "{{.State.Running}}" $id.Trim() 2>$null
    return ($status -eq "true")
}

function Wait-PostgresReady {
    param([int]$TimeoutSec = 90)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        docker compose exec -T db pg_isready -h 127.0.0.1 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 2
    }
    throw "Postgres did not become ready within ${TimeoutSec}s. Check: docker compose logs db"
}

if (-not (Test-DbServiceRunning)) {
    if ($NoStart) {
        throw 'Docker service "db" is not running. Start it first: docker compose up -d db'
    }
    Write-Host 'Service "db" is not running — starting: docker compose up -d db ...'
    docker compose up -d db
    if ($LASTEXITCODE -ne 0) { throw "docker compose up -d db failed (exit $LASTEXITCODE)" }
    Write-Host "Waiting for Postgres to accept connections..."
    Wait-PostgresReady
}

$addRole = Join-Path $PSScriptRoot "postgres_add_eduverse_role.sql"
$grantSchema = Join-Path $PSScriptRoot "postgres_grant_eduverse_schema.sql"

if (-not (Test-Path -LiteralPath $addRole)) { throw "Missing: $addRole" }
if (-not (Test-Path -LiteralPath $grantSchema)) { throw "Missing: $grantSchema" }

Write-Host "Step 1: add role eduverse (superuser=$SuperUser, db=postgres)..."
Get-Content -Raw -LiteralPath $addRole | docker compose exec -T db psql -U $SuperUser -d postgres
if ($LASTEXITCODE -ne 0) { throw "psql step 1 failed (exit $LASTEXITCODE). Try -SuperUser postgres" }

$createDb = Join-Path $PSScriptRoot "postgres_create_eduverse_database.sql"
if (-not (Test-Path -LiteralPath $createDb)) { throw "Missing: $createDb" }
Write-Host "Step 2: ensure database 'eduverse' exists (matches docker-compose POSTGRES_DB; owner eduverse)..."
$createOut = Get-Content -Raw -LiteralPath $createDb | docker compose exec -T db psql -U $SuperUser -d postgres 2>&1
$createOut | Write-Host
if ($LASTEXITCODE -ne 0) {
    $msg = "$createOut"
    if ($msg -match 'already exists') {
        Write-Host "(Database already exists — continuing.)"
    } else {
        throw "CREATE DATABASE step failed (exit $LASTEXITCODE). Output above."
    }
}

Write-Host "Step 3: schema grants (superuser=$SuperUser, db=$AppDatabase)..."
Get-Content -Raw -LiteralPath $grantSchema | docker compose exec -T db psql -U $SuperUser -d $AppDatabase
if ($LASTEXITCODE -ne 0) { throw "psql step 3 failed (exit $LASTEXITCODE). Check AppDatabase name." }

Write-Host "Done. If this is a new empty DB, run Alembic/migrations from the backend if your project uses them."
