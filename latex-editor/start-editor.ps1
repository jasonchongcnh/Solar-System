[CmdletBinding()]
param(
    [string]$ProjectFolder,
    [string]$MainFile,
    [ValidateRange(1024,65535)][int]$Port = 4380,
    [switch]$Offline,
    [switch]$NoBrowser
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
    $editorDirectory = $PSScriptRoot
    $repositoryDirectory = Split-Path -Parent $editorDirectory
    $explicitProject = $PSBoundParameters.ContainsKey('ProjectFolder') -or $PSBoundParameters.ContainsKey('MainFile')
    $configurationPath = Join-Path $editorDirectory 'editor.config.local.json'
    if (-not $ProjectFolder -and (Test-Path -LiteralPath $configurationPath)) {
        $configuration = Get-Content -LiteralPath $configurationPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $ProjectFolder = $configuration.projectFolder
        if (-not $MainFile -and $configuration.PSObject.Properties['mainFile']) { $MainFile = $configuration.mainFile }
    }
    if ($ProjectFolder) {
        $ProjectFolder = [IO.Path]::GetFullPath($ProjectFolder)
        if (-not (Test-Path -LiteralPath $ProjectFolder -PathType Container)) { throw "LaTeX project folder not found: $ProjectFolder" }
    } elseif ($MainFile) { throw 'Use -ProjectFolder together with -MainFile.' }
    $editorUrl = "http://127.0.0.1:$Port"
    function Open-RequestedProject {
        if ($explicitProject -and $ProjectFolder) {
            $openBody = @{ projectDir = $ProjectFolder }
            if ($MainFile) { $openBody.mainFile = $MainFile }
            $opened = Invoke-RestMethod -Uri "$editorUrl/api/projects/open" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($openBody | ConvertTo-Json))) -TimeoutSec 30
            $projectId = $opened.project.id
            Invoke-RestMethod -Uri "$editorUrl/api/projects/activate" -Method Post -ContentType 'application/json' -Body (@{ id = $projectId } | ConvertTo-Json) -TimeoutSec 10 | Out-Null
            return "$editorUrl/?project=$([Uri]::EscapeDataString($projectId))"
        }
        return $editorUrl
    }
    $existingEditor = $null
    try { $existingEditor = Invoke-RestMethod -Uri "$editorUrl/api/health" -TimeoutSec 2 } catch { }
    if ($existingEditor) {
        if ($existingEditor.app -ne 'latex-studio') { throw "Port $Port is already in use. Use -Port with another number." }
        if (-not $existingEditor.PSObject.Properties['multiProject'] -or -not $existingEditor.multiProject) { throw 'The previous editor version is still running. Close its server process, then run this launcher again.' }
        $readyUrl = Open-RequestedProject
        Write-Host "Editor ready: $readyUrl"
        if (-not $NoBrowser) { Start-Process -FilePath $readyUrl }
        exit 0
    }
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw 'Node.js is required to start the browser editor.' }
    $workDirectory = Join-Path $repositoryDirectory '.artifacts\latex-editor'
    $cacheDirectory = Join-Path $workDirectory 'cache'
    $compilerPath = Join-Path $workDirectory 'tools\tectonic.exe'
    $fontCacheDirectory = Join-Path $workDirectory 'font-cache'
    $fontConfiguration = Join-Path $workDirectory 'fonts.conf'
    foreach ($directory in @($workDirectory,$cacheDirectory,(Split-Path -Parent $compilerPath),$fontCacheDirectory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    if (-not (Test-Path -LiteralPath $compilerPath -PathType Leaf)) {
        $projectCompiler = if ($ProjectFolder) { Join-Path $ProjectFolder '.tools\tectonic\tectonic.exe' } else { $null }
        if (-not $projectCompiler -or -not (Test-Path -LiteralPath $projectCompiler -PathType Leaf)) { throw "Portable compiler not found. Place tectonic.exe in $(Split-Path -Parent $compilerPath), or start once with a prepared LaTeX folder." }
        Copy-Item -LiteralPath $projectCompiler -Destination $compilerPath
    }
    if ($ProjectFolder -and -not (Test-Path -LiteralPath (Join-Path $cacheDirectory 'formats'))) {
        $projectCache = Join-Path $ProjectFolder '.tools\cache'
        if (Test-Path -LiteralPath $projectCache -PathType Container) { Get-ChildItem -LiteralPath $projectCache -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $cacheDirectory -Recurse -Force } }
    }
    $windowsFontsXml = [Security.SecurityElement]::Escape((Join-Path $env:WINDIR 'Fonts').Replace('\','/'))
    $fontCacheXml = [Security.SecurityElement]::Escape($fontCacheDirectory.Replace('\','/'))
    [IO.File]::WriteAllText($fontConfiguration, ('<?xml version="1.0"?><fontconfig><dir>' + $windowsFontsXml + '</dir><cachedir>' + $fontCacheXml + '</cachedir></fontconfig>'), [Text.UTF8Encoding]::new($false))
    $environmentKeys = @('LATEX_PROJECT_DIR','LATEX_SOURCE_NAME','LATEX_WORK_DIR','LATEX_ASSET_DIR','LATEX_COMPILER_PATH','LATEX_CACHE_DIR','LATEX_OFFLINE','FONTCONFIG_FILE','PORT')
    $oldEnvironment = @{}
    foreach ($key in $environmentKeys) { $oldEnvironment[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
    try {
        [Environment]::SetEnvironmentVariable('LATEX_PROJECT_DIR',$ProjectFolder,'Process')
        [Environment]::SetEnvironmentVariable('LATEX_SOURCE_NAME',$MainFile,'Process')
        [Environment]::SetEnvironmentVariable('LATEX_WORK_DIR',$workDirectory,'Process')
        [Environment]::SetEnvironmentVariable('LATEX_ASSET_DIR',$null,'Process')
        [Environment]::SetEnvironmentVariable('LATEX_COMPILER_PATH',$compilerPath,'Process')
        [Environment]::SetEnvironmentVariable('LATEX_CACHE_DIR',$cacheDirectory,'Process')
        [Environment]::SetEnvironmentVariable('LATEX_OFFLINE',$(if ($Offline) { '1' } else { $null }),'Process')
        [Environment]::SetEnvironmentVariable('FONTCONFIG_FILE',$fontConfiguration,'Process')
        [Environment]::SetEnvironmentVariable('PORT',[string]$Port,'Process')
        $serverPath = Join-Path $editorDirectory 'server.mjs'
        $serverProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList @('"' + $serverPath + '"') -WorkingDirectory $repositoryDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workDirectory 'server.stdout.log') -RedirectStandardError (Join-Path $workDirectory 'server.stderr.log') -PassThru
    } finally { foreach ($key in $environmentKeys) { [Environment]::SetEnvironmentVariable($key,$oldEnvironment[$key],'Process') } }
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($serverProcess.HasExited) { throw "The editor could not start. Read $(Join-Path $workDirectory 'server.stderr.log') for details." }
        try {
            $health = Invoke-RestMethod -Uri "$editorUrl/api/health" -TimeoutSec 1
            if ($health.app -eq 'latex-studio') { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw "The editor has not become ready. Check $(Join-Path $workDirectory 'server.stderr.log')." }
    $readyUrl = Open-RequestedProject
    Write-Host "Editor ready: $readyUrl"
    if (-not $NoBrowser) { Start-Process -FilePath $readyUrl }
} catch { Write-Error -Message $_.Exception.Message -ErrorAction Continue; exit 1 }
