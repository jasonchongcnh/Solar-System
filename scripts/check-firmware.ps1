param(
    [string]$ArduinoCli = 'arduino-cli',
    [string]$ConfigFile = '',
    [string]$NodeBoard = 'esp32:esp32:XIAO_ESP32C3:CDCOnBoot=default',
    [string]$GatewayBoard = 'esp32:esp32:esp32',
    [int]$BuildJobs = 1
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeSketch = Join-Path $repoRoot 'firmware/esp32_solar_node'
$gatewaySketch = Join-Path $repoRoot 'firmware/esp32_base_station_gateway'
$nodeHeader = [IO.File]::ReadAllBytes((Join-Path $nodeSketch 'SolarProtocol.h'))
$gatewayHeader = [IO.File]::ReadAllBytes((Join-Path $gatewaySketch 'SolarProtocol.h'))
if ([Convert]::ToBase64String($nodeHeader) -cne [Convert]::ToBase64String($gatewayHeader)) {
    throw 'SolarProtocol.h differs between node and gateway. Synchronize the wire protocol first.'
}

$cliArguments = @()
if ($ConfigFile) { $cliArguments += @('--config-file', $ConfigFile) }
$buildRoot = Join-Path ([IO.Path]::GetTempPath()) ('hexagon-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $buildRoot | Out-Null

Write-Host "Compile node: $NodeBoard (confirm that this matches your actual board before upload)"
& $ArduinoCli @cliArguments compile --jobs $BuildJobs --fqbn $NodeBoard --warnings all --build-path (Join-Path $buildRoot 'node') $nodeSketch
if ($LASTEXITCODE -ne 0) { throw 'Node compilation failed.' }

Write-Host "Compile gateway: $GatewayBoard"
& $ArduinoCli @cliArguments compile --jobs $BuildJobs --fqbn $GatewayBoard --warnings all --build-path (Join-Path $buildRoot 'gateway') $gatewaySketch
if ($LASTEXITCODE -ne 0) { throw 'Gateway compilation failed.' }

Write-Host "Both firmware builds passed. Build output: $buildRoot"
Write-Host 'No boards were uploaded or reset.'
