<#
.SYNOPSIS
    Compares AddmusicK's compiled song data against this editor's .bin export.

.DESCRIPTION
    AddmusicK writes asm/SNES/bin/musicXX.bin for every song it compiles. That
    file is a 12-byte RATS header followed by exactly the blob this editor's
    ".bin" export produces (AddmusicK.cpp:1274 assigns finalData from byte 12).

        bytes 0-3    "STAR"
        bytes 4-5    RATS size
        bytes 6-7    RATS size, complemented
        bytes 8-9    padded size
        bytes 10-11  songDataARAMPos   <- the address to compile at
        bytes 12+    finalData         <- the bytes to compare

    Unlike diffing whole SPC files, this compares like for like: both blobs are
    the same song at the same load address, so every difference is a real
    compiler difference rather than a layout artefact.

    Run with one argument to read the header and see the load address and channel
    layout. Run with two to diff.

    The editor derives its load address from the driver, so to make an export
    comparable, load the main.bin sitting in the same asm/SNES/bin/ folder as the
    musicXX.bin you are diffing against.

    Differences are attributed to a channel where possible, by walking the song's
    own phrase pointer table. Note that loop and subroutine bodies live in a
    single block after all eight channels, and nothing in the header marks where
    it starts — so those bytes are reported against the last channel, labelled
    "channel N + loop block". A difference there may belong to any channel's
    loop body.

    Exits 0 when identical, 1 when different, 2 on a usage or file error.

.PARAMETER Reference
    AddmusicK's asm/SNES/bin/musicXX.bin.

.PARAMETER Actual
    This editor's exported .bin. Optional — omit to just inspect the reference.
    A RATS header is stripped from either file if present.

.PARAMETER MaxRuns
    Maximum number of differing runs to list. Default 20.

.PARAMETER Context
    Bytes of hex shown per differing run. Default 16.

.PARAMETER MergeGap
    Differences separated by this many identical bytes or fewer are reported as
    one run. Default 8.

.EXAMPLE
    .\Compare-SongBin.ps1 'C:\AddmusicK\asm\SNES\bin\music0A.bin'
    Prints the load address and channel layout. Compile at that address.

.EXAMPLE
    .\Compare-SongBin.ps1 music0A.bin "$HOME\Downloads\My Song.bin"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)][string]$Reference,
    [Parameter(Position = 1)][string]$Actual,
    [int]$MaxRuns = 20,
    [int]$Context = 16,
    [int]$MergeGap = 8
)

$ErrorActionPreference = 'Stop'

function Read-Bytes {
    param([string]$Path, [string]$Label)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Write-Host "error: $Label file not found: $Path" -ForegroundColor Red
        exit 2
    }
    return [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Path).ProviderPath)
}

function Get-Word {
    # [int] casts are required: PowerShell masks the -shl count to the width of
    # the left operand's type, so a [byte] shifted by 8 silently yields itself.
    param([byte[]]$Bytes, [int]$Offset)
    return ([int]$Bytes[$Offset]) -bor (([int]$Bytes[$Offset + 1]) -shl 8)
}

function Format-Hex {
    param([byte[]]$Bytes, [int]$Start, [int]$Count)

    $end = [Math]::Min($Start + $Count, $Bytes.Length)
    if ($Start -ge $end) { return '(past end)' }
    return ((($Start..($end - 1)) | ForEach-Object { '{0:X2}' -f $Bytes[$_] }) -join ' ')
}

<#
    Splits a file into RATS metadata and payload. Files without the header are
    passed through unchanged, so the editor's raw .bin export works as either
    argument.
#>
function Split-SongFile {
    param([byte[]]$Bytes, [string]$Label)

    $magic = [System.Text.Encoding]::ASCII.GetString($Bytes, 0, [Math]::Min(4, $Bytes.Length))
    if ($magic -ne 'STAR') {
        return [pscustomobject]@{
            Payload = $Bytes; AramAddress = $null; HasHeader = $false; PaddedSize = $null
        }
    }

    if ($Bytes.Length -lt 12) {
        Write-Host "error: $Label has a RATS tag but is only $($Bytes.Length) bytes." -ForegroundColor Red
        exit 2
    }

    $ratsSize = Get-Word $Bytes 4
    $complement = Get-Word $Bytes 6
    if (($ratsSize -bxor 0xFFFF) -ne $complement) {
        Write-Host ("warning: {0} RATS size 0x{1:X4} does not match its complement 0x{2:X4}." -f $Label, $ratsSize, $complement) -ForegroundColor Yellow
    }

    $payload = New-Object byte[] ($Bytes.Length - 12)
    [Array]::Copy($Bytes, 12, $payload, 0, $payload.Length)

    # RATSSize is totalSize + 3 (AddmusicK.cpp:1239), so the payload should be
    # RATSSize - 3 bytes long.
    $expected = $ratsSize - 3
    if ($payload.Length -ne $expected) {
        Write-Host ("warning: {0} payload is {1} bytes; the RATS tag implies {2}." -f $Label, $payload.Length, $expected) -ForegroundColor Yellow
    }

    return [pscustomobject]@{
        Payload     = $payload
        AramAddress = (Get-Word $Bytes 10)
        HasHeader   = $true
        PaddedSize  = (Get-Word $Bytes 8)
    }
}

<#
    Walks the song header to recover the channel layout.

    The header is a phrase list: word 0 points at a block of eight channel
    pointers, optionally followed by a second block for the intro, then a $00FF
    loop command and its target. Channel data follows the header in order, so
    each channel runs until the next one starts.
#>
function Get-SongLayout {
    param([byte[]]$Payload, [int]$AramAddress)

    $regions = [System.Collections.Generic.List[object]]::new()
    if ($Payload.Length -lt 20 -or $null -eq $AramAddress) { return $regions }

    $phraseBlock = (Get-Word $Payload 0) - $AramAddress
    if ($phraseBlock -lt 4 -or ($phraseBlock + 16) -gt $Payload.Length) { return $regions }

    # A second phrase block exactly 16 bytes later means the song has an intro.
    $second = Get-Word $Payload 2
    $hasIntro = ($second - $AramAddress) -eq ($phraseBlock + 16)
    $headerSize = $phraseBlock + 16 + $(if ($hasIntro) { 16 } else { 0 })

    $channels = [System.Collections.Generic.List[object]]::new()
    for ($ch = 0; $ch -lt 8; $ch++) {
        $pointer = Get-Word $Payload ($phraseBlock + $ch * 2)
        if ($pointer -eq 0) { continue }
        $start = $pointer - $AramAddress
        if ($start -lt $headerSize -or $start -ge $Payload.Length) { continue }
        $channels.Add([pscustomobject]@{ Channel = $ch; Start = $start })
    }

    $regions.Add([pscustomobject]@{
        Name  = "header$(if ($hasIntro) { ' (with intro)' } else { '' })"
        Start = 0
        End   = $headerSize
    })

    $sorted = $channels | Sort-Object Start
    for ($i = 0; $i -lt $sorted.Count; $i++) {
        $isLast = ($i -eq $sorted.Count - 1)
        $regions.Add([pscustomobject]@{
            Name  = "channel $($sorted[$i].Channel)$(if ($isLast) { ' + loop block' } else { '' })"
            Start = $sorted[$i].Start
            End   = $(if ($isLast) { $Payload.Length } else { $sorted[$i + 1].Start })
        })
    }

    return $regions
}

function Get-RegionName {
    param($Regions, [int]$Offset)

    foreach ($region in $Regions) {
        if ($Offset -ge $region.Start -and $Offset -lt $region.End) { return $region.Name }
    }
    return 'unknown'
}

function Format-Address16 {
    param($Value)
    if ($null -eq $Value) { return 'unknown' }
    return '${0:X4}' -f $Value
}

function Write-FileInfo {
    param([string]$Label, [string]$Path, $File)

    Write-Host ('{0,-10} {1}' -f $Label, $Path)
    if ($File.HasHeader) {
        Write-Host ('           RATS header · payload {0:N0} bytes · padded size 0x{1:X4} · load address {2}' -f `
            $File.Payload.Length, $File.PaddedSize, (Format-Address16 $File.AramAddress))
    }
    else {
        Write-Host ('           no RATS header · {0:N0} bytes · load address unknown' -f $File.Payload.Length)
    }
}

# --- load -------------------------------------------------------------------
$refFile = Split-SongFile (Read-Bytes $Reference 'reference') 'reference'
$hasActual = $PSBoundParameters.ContainsKey('Actual')
$actFile = if ($hasActual) { Split-SongFile (Read-Bytes $Actual 'actual') 'actual' } else { $null }

Write-Host ''
Write-FileInfo 'reference' $Reference $refFile
if ($hasActual) { Write-FileInfo 'actual' $Actual $actFile }

# Only one file needs a RATS header for us to know the load address, and it may
# be either one — the arguments are often given in the other order.
$effectiveAddress = $refFile.AramAddress
if ($null -eq $effectiveAddress -and $null -ne $actFile) { $effectiveAddress = $actFile.AramAddress }

if ($null -ne $effectiveAddress) {
    Write-Host ''
    Write-Host ('song loads at ${0:X4}.' -f $effectiveAddress) -ForegroundColor Green
    Write-Host '  The editor derives this from the driver, so load the main.bin next to this' -ForegroundColor DarkGray
    Write-Host '  file (same asm/SNES/bin/ folder) and its export will match automatically.' -ForegroundColor DarkGray
}

# Parse the layout from whichever file's load address we actually know, so a
# mismatched pair still gets channel annotations.
$layoutPayload = if ($refFile.HasHeader -or $null -eq $actFile -or -not $actFile.HasHeader) {
    $refFile.Payload
} else {
    $actFile.Payload
}
$layout = Get-SongLayout $layoutPayload $effectiveAddress
if ($layout.Count -gt 0) {
    Write-Host ''
    ($layout | ForEach-Object {
        [pscustomobject]@{
            Region = $_.Name
            Offset = '+0x{0:X4}' -f $_.Start
            ARAM   = if ($null -ne $effectiveAddress) { '${0:X4}' -f ($effectiveAddress + $_.Start) } else { '--' }
            Size   = $_.End - $_.Start
        }
    } | Format-Table -AutoSize | Out-String).TrimEnd() | Write-Host
}

if (-not $hasActual) {
    Write-Host ''
    Write-Host 'no second file given — nothing to compare.' -ForegroundColor DarkGray
    Write-Host ''
    exit 0
}

if ($refFile.HasHeader -and $actFile.HasHeader -and $refFile.AramAddress -ne $actFile.AramAddress) {
    Write-Host ''
    Write-Host ('warning: load addresses differ ({0} vs {1}); pointers cannot match.' -f `
        (Format-Address16 $refFile.AramAddress), (Format-Address16 $actFile.AramAddress)) -ForegroundColor Yellow
}
Write-Host ''

# --- compare ----------------------------------------------------------------
$ref = $refFile.Payload
$act = $actFile.Payload

if ($ref.Length -ne $act.Length) {
    Write-Host ('size mismatch: {0:N0} vs {1:N0} bytes ({2:+#;-#;0})' -f $ref.Length, $act.Length, ($act.Length - $ref.Length)) -ForegroundColor Yellow
}

$limit = [Math]::Min($ref.Length, $act.Length)
$diffs = [System.Collections.Generic.List[int]]::new()
for ($i = 0; $i -lt $limit; $i++) {
    if ($ref[$i] -ne $act[$i]) { $diffs.Add($i) }
}

if ($diffs.Count -eq 0 -and $ref.Length -eq $act.Length) {
    Write-Host 'song data is byte-identical.' -ForegroundColor Green
    Write-Host ''
    exit 0
}

if ($diffs.Count -eq 0) {
    Write-Host ('the first {0:N0} bytes match; the files differ only in length.' -f $limit) -ForegroundColor Yellow
    Write-Host ''
    exit 1
}

<#
    Before listing bytes, check whether every difference is explained by one
    constant offset applied to 16-bit little-endian values.

    That is the signature of the same song compiled at two different load
    addresses: the data is identical and only the relocated pointers moved. It is
    by far the most common false alarm in this comparison, and it looks alarming
    in a raw byte diff, so diagnose it explicitly.
#>
#
# Pointers are NOT word-aligned within the blob: loop calls ($E9 lo hi) can land
# on any offset. So walk the differences and try to consume each one as a 16-bit
# value starting either at it or one byte before it.
#
function Test-ConstantRelocation {
    param([byte[]]$Ref, [byte[]]$Act, [int]$Limit, [int]$Delta)

    if ($Delta -eq 0) { return -1 }
    $i = 0
    $words = 0
    while ($i -lt $Limit) {
        if ($Ref[$i] -eq $Act[$i]) { $i++; continue }

        if (($i + 1) -lt $Limit -and ((Get-Word $Act $i) - (Get-Word $Ref $i)) -eq $Delta) {
            $i += 2; $words++; continue
        }
        # The low byte may have coincided, putting the word one byte earlier.
        if ($i -ge 1 -and ((Get-Word $Act ($i - 1)) - (Get-Word $Ref ($i - 1))) -eq $Delta) {
            $i++; $words++; continue
        }
        return -1
    }
    return $words
}

$relocationDelta = $null
$relocationWords = 0
if ($ref.Length -eq $act.Length -and $diffs.Count -gt 0) {
    $first = $diffs[0]
    $candidates = [System.Collections.Generic.List[int]]::new()
    if ($null -ne $refFile.AramAddress -and $null -ne $actFile.AramAddress) {
        $candidates.Add($actFile.AramAddress - $refFile.AramAddress)
    }
    if (($first + 1) -lt $limit) { $candidates.Add((Get-Word $act $first) - (Get-Word $ref $first)) }
    if ($first -ge 1) { $candidates.Add((Get-Word $act ($first - 1)) - (Get-Word $ref ($first - 1))) }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if ($candidate -eq 0 -or $limit -lt 2) { continue }

        # Guard against a false positive: any single differing byte can be read
        # as some 16-bit delta, which would explain away a real bug. Offset 0 of
        # every song header is a pointer to its phrase block and therefore always
        # moves with the song, so if it did not shift by this delta, the blobs
        # were compiled at the same address and the differences are real.
        if (((Get-Word $act 0) - (Get-Word $ref 0)) -ne $candidate) { continue }

        $words = Test-ConstantRelocation $ref $act $limit $candidate
        if ($words -gt 0) { $relocationDelta = $candidate; $relocationWords = $words; break }
    }
}

if ($null -ne $relocationDelta) {
    $delta = $relocationDelta
    $count = $relocationWords
    $sign = if ($delta -lt 0) { '-' } else { '+' }
    Write-Host ''
    Write-Host ('all differences are one constant offset: {0} 16-bit value(s), each shifted by {1}0x{2:X4}.' -f `
        $count, $sign, [Math]::Abs($delta)) -ForegroundColor Green
    Write-Host 'the song data is identical — only relocated pointers differ, so the two blobs' -ForegroundColor Green
    Write-Host 'were compiled at load addresses that far apart.' -ForegroundColor Green
    # Only one file needs a RATS header: the delta gives us the other address.
    # actWord = refWord + delta, so actAddress = refAddress + delta.
    $refAddr = $refFile.AramAddress
    $actAddr = $actFile.AramAddress
    if ($null -eq $refAddr -and $null -ne $actAddr) { $refAddr = $actAddr - $delta }
    elseif ($null -eq $actAddr -and $null -ne $refAddr) { $actAddr = $refAddr + $delta }

    if ($null -ne $refAddr -and $null -ne $actAddr) {
        Write-Host ''
        Write-Host ('  reference compiled at {0}' -f (Format-Address16 $refAddr))
        Write-Host ('  actual    compiled at {0}' -f (Format-Address16 $actAddr))

        # Whichever file carries the RATS header came from AddmusicK. The editor
        # takes its load address from the driver, so the fix is to load that
        # install's main.bin rather than to enter an address by hand.
        Write-Host '  -> the two were compiled for different drivers. Load the main.bin from' -ForegroundColor Cyan
        Write-Host '     the same asm/SNES/bin/ folder into the editor and re-export.' -ForegroundColor Cyan
    }
    Write-Host ''
}

# Merge nearby differences so scattered bytes stay readable.
$runs = [System.Collections.Generic.List[object]]::new()
$start = $diffs[0]; $end = $diffs[0]
foreach ($offset in $diffs) {
    if ($offset -le $end + $MergeGap) { $end = $offset }
    else {
        $runs.Add([pscustomobject]@{ Start = $start; End = $end })
        $start = $offset; $end = $offset
    }
}
$runs.Add([pscustomobject]@{ Start = $start; End = $end })

Write-Host ('{0} differing byte(s) in {1} run(s):' -f $diffs.Count, $runs.Count) -ForegroundColor Yellow
Write-Host ''

$shown = 0
foreach ($run in $runs) {
    if ($shown -ge $MaxRuns) {
        Write-Host ('... and {0} more run(s). Raise -MaxRuns to see them.' -f ($runs.Count - $shown)) -ForegroundColor DarkGray
        break
    }
    $length = $run.End - $run.Start + 1
    $where = '+0x{0:X4}' -f $run.Start
    if ($null -ne $refFile.AramAddress) { $where += '  (ARAM ${0:X4})' -f ($refFile.AramAddress + $run.Start) }
    Write-Host ('  {0}  {1} byte(s)  [{2}]' -f $where, $length, (Get-RegionName $layout $run.Start)) -ForegroundColor Cyan
    Write-Host ('    amk  {0}' -f (Format-Hex $ref $run.Start $Context))
    Write-Host ('    ours {0}' -f (Format-Hex $act $run.Start $Context))
    $shown++
}

Write-Host ''
exit 1
