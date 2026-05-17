$ErrorActionPreference = "Continue"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $ScriptRoot "config.ps1"
$ExampleConfigPath = Join-Path $ScriptRoot "config.example.ps1"

if (-not (Test-Path $ConfigPath)) {
    Write-Host "找不到 config.ps1，請先複製 config.example.ps1 成 config.ps1 並修改 EC2_HOST。"
    Write-Host "範例: Copy-Item `"$ExampleConfigPath`" `"$ConfigPath`""
    exit 1
}

. $ConfigPath

if (-not [System.IO.Path]::IsPathRooted($ManifestPath)) {
    $ManifestPath = Join-Path $ScriptRoot $ManifestPath
}

function Load-Manifest {
    if (-not (Test-Path $ManifestPath)) {
        return @{}
    }

    try {
        $json = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($json)) {
            return @{}
        }
        $object = $json | ConvertFrom-Json
        $table = @{}
        foreach ($property in $object.PSObject.Properties) {
            $table[$property.Name] = $property.Value
        }
        return $table
    } catch {
        Write-Host "讀取 manifest 失敗，將以空 manifest 繼續: $($_.Exception.Message)"
        return @{}
    }
}

function Save-Manifest($Manifest) {
    $parent = Split-Path -Parent $ManifestPath
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $Manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
}

function Test-FileStable($File) {
    try {
        $first = Get-Item -LiteralPath $File.FullName
        Start-Sleep -Seconds 2
        $second = Get-Item -LiteralPath $File.FullName
        return ($first.Length -eq $second.Length -and $first.LastWriteTimeUtc -eq $second.LastWriteTimeUtc)
    } catch {
        Write-Host "檢查檔案穩定性失敗: $($File.FullName) $($_.Exception.Message)"
        return $false
    }
}

function Send-AssayProcessFile($File, $Hash) {
    $client = [System.Net.Http.HttpClient]::new()
    $form = [System.Net.Http.MultipartFormDataContent]::new()
    $stream = $null

    try {
        $stream = [System.IO.File]::OpenRead($File.FullName)
        $fileContent = [System.Net.Http.StreamContent]::new($stream)
        $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("text/csv")

        $form.Add($fileContent, "file", $File.Name)
        $form.Add([System.Net.Http.StringContent]::new($File.FullName), "source_file")
        $form.Add([System.Net.Http.StringContent]::new($File.Name), "source_file_name")
        $form.Add([System.Net.Http.StringContent]::new($File.LastWriteTimeUtc.ToString("o")), "file_mtime")

        $response = $client.PostAsync($UploadUrl, $form).GetAwaiter().GetResult()
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if (-not $response.IsSuccessStatusCode) {
            throw "HTTP $($response.StatusCode): $body"
        }

        $result = $body | ConvertFrom-Json
        if (-not $result.ok) {
            throw "API error: $($result.error)"
        }

        Write-Host "上傳完成: $($File.FullName) status=$($result.status)"
        return $true
    } catch {
        Write-Host "上傳失敗: $($File.FullName) $($_.Exception.Message)"
        return $false
    } finally {
        if ($stream) { $stream.Dispose() }
        $form.Dispose()
        $client.Dispose()
    }
}

Write-Host "開始監控 AssayProcess CSV"
Write-Host "WatchRoot: $WatchRoot"
Write-Host "Pattern: $FilePattern"
Write-Host "UploadUrl: $UploadUrl"
Write-Host "PollSeconds: $PollSeconds (下一輪掃描會以每輪開始時間計算，不會掃完立刻重掃)"

$manifest = Load-Manifest

while ($true) {
    $cycleStart = Get-Date
    $scanCount = 0
    $skipCount = 0
    $uploadCount = 0
    $failCount = 0

    try {
        Write-Host "[$($cycleStart.ToString("yyyy-MM-dd HH:mm:ss"))] 開始掃描..."
        $files = Get-ChildItem -LiteralPath $WatchRoot -Filter $FilePattern -File -Recurse -ErrorAction SilentlyContinue
        $scanCount = @($files).Count

        foreach ($file in $files) {
            try {
                if (-not (Test-FileStable $file)) {
                    Write-Host "檔案尚未穩定，略過本輪: $($file.FullName)"
                    $skipCount++
                    continue
                }

                $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
                $key = $file.FullName
                $previous = $manifest[$key]

                if ($previous -and $previous.Hash -eq $hash -and [int64]$previous.Size -eq [int64]$file.Length) {
                    $skipCount++
                    continue
                }

                $uploaded = Send-AssayProcessFile $file $hash
                if ($uploaded) {
                    $uploadCount++
                    $manifest[$key] = [PSCustomObject]@{
                        FullName = $file.FullName
                        Hash = $hash
                        Size = $file.Length
                        LastWriteTime = $file.LastWriteTimeUtc.ToString("o")
                        UploadedAt = (Get-Date).ToUniversalTime().ToString("o")
                    }
                    Save-Manifest $manifest
                } else {
                    $failCount++
                }
            } catch {
                $failCount++
                Write-Host "處理檔案失敗: $($file.FullName) $($_.Exception.Message)"
            }
        }
    } catch {
        Write-Host "掃描失敗: $($_.Exception.Message)"
    }

    $cycleEnd = Get-Date
    $elapsedSeconds = [int][Math]::Ceiling(($cycleEnd - $cycleStart).TotalSeconds)
    $sleepSeconds = [Math]::Max(5, [int]$PollSeconds - $elapsedSeconds)
    Write-Host "[$($cycleEnd.ToString("yyyy-MM-dd HH:mm:ss"))] 掃描完成: files=$scanCount uploaded=$uploadCount skipped=$skipCount failed=$failCount elapsed=${elapsedSeconds}s"
    if ($elapsedSeconds -ge [int]$PollSeconds) {
        Write-Host "提醒: 本輪掃描耗時已超過 PollSeconds，將等待 5 秒後開始下一輪。建議把 PollSeconds 調大，例如 1800。"
    } else {
        Write-Host "下一輪掃描約在 $((Get-Date).AddSeconds($sleepSeconds).ToString("yyyy-MM-dd HH:mm:ss")) 開始。"
    }
    Start-Sleep -Seconds $sleepSeconds
}
