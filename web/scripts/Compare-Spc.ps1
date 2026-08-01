<#
.SYNOPSIS
    Binary-compares two SPC files, grouping differences by structural region.

.DESCRIPTION
    A raw byte diff of two SPCs is noisy: the ID666 tags and the dump date differ
    for uninteresting reasons. This reports differences per region instead, so
    "the ARAM is identical but the tags differ" is obvious at a glance.

    ARAM differences are reported with their ARAM addresses ($0400, $236F, ...)
    rather than file offsets, so they can be matched against a song layout.

    Exits 0 when the compared regions are identical, 1 when they differ, and 2 on
    a usage or file error.

.PARAMETER Reference
    The known-good file — normally AddmusicK's own SPC output.

.PARAMETER Actual
    The file to check.

.PARAMETER IgnoreTags
    Skip the ID666 metadata block ($2E-$D0: title, game, dumper, comment, date,
    length, fade, artist). Use this when only the emulator state matters.

.PARAMETER MaxRuns
    Maximum number of differing runs to list. Default 20.

.PARAMETER Context
    Bytes of hex to show for each differing run. Default 16.

.PARAMETER MergeGap
    Runs separated by this many identical bytes or fewer are reported as one.
    Default 8. Keeps scattered single-byte differences readable.

.EXAMPLE
    .\Compare-Spc.ps1 amk.spc mine.spc

.EXAMPLE
    .\Compare-Spc.ps1 amk.spc mine.spc -IgnoreTags -MaxRuns 50
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)][string]$Reference,
    [Parameter(Mandatory, Position = 1)][string]$Actual,
    [switch]$IgnoreTags,
    [int]$MaxRuns = 20,
    [int]$Context = 16,
    [int]$MergeGap = 8
)

$ErrorActionPreference = 'Stop'

# --- structural map of an SPC file -----------------------------------------
# Start is inclusive, End exclusive. ARAM occupies $100-$10100 in the file.
$ARAM_BASE = 0x100
$regions = @(
    [pscustomobject]@{ Name = 'signature + flags'; Start = 0x00000; End = 0x00025; Tag = $false }
    [pscustomobject]@{ Name = 'PC register';       Start = 0x00025; End = 0x00027; Tag = $false }
    [pscustomobject]@{ Name = 'A/X/Y/PSW/SP';      Start = 0x00027; End = 0x0002E; Tag = $false }
    [pscustomobject]@{ Name = 'tag: title';        Start = 0x0002E; End = 0x0004E; Tag = $true  }
    [pscustomobject]@{ Name = 'tag: game';         Start = 0x0004E; End = 0x0006E; Tag = $true  }
    [pscustomobject]@{ Name = 'tag: dumper';       Start = 0x0006E; End = 0x0007E; Tag = $true  }
    [pscustomobject]@{ Name = 'tag: comment';      Start = 0x0007E; End = 0x0009E; Tag = $true  }
    [pscustomobject]@{ Name = 'tag: date';         Start = 0x0009E; End = 0x000A9; Tag = $true  }
    [pscustomobject]@{ Name = 'tag: length';       Start = 0x000A9; End = 0x000AC; Tag = $true  }
    [pscustomobject]@{ Name = 'tag: fade';         Start = 0x000AC; End = 0x000B1; Tag = $true  }
    [pscustomobject]@{ Name = 'tag: artist';       Start = 0x000B1; End = 0x000D1; Tag = $true  }
    [pscustomobject]@{ Name = 'header tail';       Start = 0x000D1; End = 0x00100; Tag = $false }
    [pscustomobject]@{ Name = 'ARAM';              Start = 0x00100; End = 0x10100; Tag = $false }
    [pscustomobject]@{ Name = 'DSP registers';     Start = 0x10100; End = 0x10180; Tag = $false }
    [pscustomobject]@{ Name = 'unused';            Start = 0x10180; End = 0x101C0; Tag = $false }
    [pscustomobject]@{ Name = 'IPL ROM';           Start = 0x101C0; End = 0x10200; Tag = $false }
)

function Read-SpcFile {
    param([string]$Path, [string]$Label)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Write-Host "error: $Label file not found: $Path" -ForegroundColor Red
        exit 2
    }
    $resolved = (Resolve-Path -LiteralPath $Path).ProviderPath
    $bytes = [System.IO.File]::ReadAllBytes($resolved)
    if ($bytes.Length -lt 0x10200) {
        Write-Host "warning: $Label is $($bytes.Length) bytes; a full SPC is 66048 (0x10200)." -ForegroundColor Yellow
    }
    return $bytes
}

function Format-Hex {
    param([byte[]]$Bytes, [int]$Start, [int]$Count)

    $end = [Math]::Min($Start + $Count, $Bytes.Length)
    if ($Start -ge $end) { return '(past end of file)' }
    $slice = for ($i = $Start; $i -lt $end; $i++) { '{0:X2}' -f $Bytes[$i] }
    return ($slice -join ' ')
}

function Format-Address {
    param([int]$Offset)

    if ($Offset -ge $ARAM_BASE -and $Offset -lt 0x10100) {
        return 'ARAM ${0:X4}' -f ($Offset - $ARAM_BASE)
    }
    return 'file +0x{0:X5}' -f $Offset
}

function Get-RegionName {
    param([int]$Offset)

    foreach ($region in $regions) {
        if ($Offset -ge $region.Start -and $Offset -lt $region.End) { return $region.Name }
    }
    return 'beyond 0x10200'
}

# --- load -------------------------------------------------------------------
$ref = Read-SpcFile -Path $Reference -Label 'reference'
$act = Read-SpcFile -Path $Actual -Label 'actual'

Write-Host ''
Write-Host ('reference  {0}  ({1:N0} bytes)' -f $Reference, $ref.Length)
Write-Host ('actual     {0}  ({1:N0} bytes)' -f $Actual, $act.Length)
if ($IgnoreTags) { Write-Host 'ignoring   ID666 tag block ($2E-$D0)' -ForegroundColor DarkGray }
Write-Host ''

if ($ref.Length -ne $act.Length) {
    Write-Host ('size mismatch: {0:N0} vs {1:N0} bytes' -f $ref.Length, $act.Length) -ForegroundColor Yellow
    Write-Host ''
}

# --- key fields -------------------------------------------------------------
# Worth surfacing explicitly: these three decide whether an SPC plays at all.
$fields = @(
    [pscustomobject]@{ Field = 'PC (entry point)';    Offset = 0x25;    Width = 2 }
    [pscustomobject]@{ Field = 'SP';                  Offset = 0x2B;    Width = 1 }
    [pscustomobject]@{ Field = 'DSP $5D (sample dir)'; Offset = 0x1015D; Width = 1 }
    [pscustomobject]@{ Field = 'ARAM $F5 (port 1)';   Offset = 0x1F5;   Width = 1 }
    [pscustomobject]@{ Field = 'ARAM $F6 (song id)';  Offset = 0x1F6;   Width = 1 }
)

$keyRows = foreach ($f in $fields) {
    function Read-Field([byte[]]$b) {
        if ($f.Offset + $f.Width -gt $b.Length) { return '--' }
        # [int] cast is required: PowerShell masks the -shl count to the width of
        # the left operand's type, so a [byte] shifted by 8 masks to 8 -band 7 = 0
        # and silently returns the unshifted value.
        if ($f.Width -eq 2) {
            return '${0:X4}' -f ([int]$b[$f.Offset] -bor ([int]$b[$f.Offset + 1] -shl 8))
        }
        return '${0:X2}' -f $b[$f.Offset]
    }
    $a = Read-Field $ref
    $b = Read-Field $act
    [pscustomobject]@{
        Field     = $f.Field
        Reference = $a
        Actual    = $b
        Match     = if ($a -eq $b) { 'yes' } else { 'NO' }
    }
}
$keyRows | Format-Table -AutoSize | Out-String | Write-Host

# --- per-region comparison --------------------------------------------------
$limit = [Math]::Min($ref.Length, $act.Length)
$diffOffsets = [System.Collections.Generic.List[int]]::new()
$rows = foreach ($region in $regions) {
    $start = $region.Start
    $end = [Math]::Min($region.End, $limit)
    if ($start -ge $end) { continue }

    $skipped = $IgnoreTags -and $region.Tag
    $differing = 0
    if (-not $skipped) {
        for ($i = $start; $i -lt $end; $i++) {
            if ($ref[$i] -ne $act[$i]) {
                $differing++
                $diffOffsets.Add($i)
            }
        }
    }

    [pscustomobject]@{
        Region  = $region.Name
        Range   = '{0:X5}-{1:X5}' -f $region.Start, ($region.End - 1)
        Size    = $region.End - $region.Start
        Differs = if ($skipped) { 'skipped' } elseif ($differing -eq 0) { '-' } else { $differing }
    }
}
$rows | Format-Table -AutoSize | Out-String | Write-Host

# --- differing runs ---------------------------------------------------------
if ($diffOffsets.Count -eq 0) {
    if ($ref.Length -ne $act.Length) {
        Write-Host 'compared regions are identical, but the files differ in length.' -ForegroundColor Yellow
        Write-Host ''
        exit 1
    }
    Write-Host 'files are identical over all compared regions.' -ForegroundColor Green
    Write-Host ''
    exit 0
}

# Merge nearby differences so scattered single bytes do not flood the output.
$runs = [System.Collections.Generic.List[object]]::new()
$runStart = $diffOffsets[0]
$runEnd = $diffOffsets[0]
foreach ($offset in $diffOffsets) {
    if ($offset -le $runEnd + $MergeGap) {
        $runEnd = $offset
    }
    else {
        $runs.Add([pscustomobject]@{ Start = $runStart; End = $runEnd })
        $runStart = $offset
        $runEnd = $offset
    }
}
$runs.Add([pscustomobject]@{ Start = $runStart; End = $runEnd })

Write-Host ('{0} differing byte(s) in {1} run(s):' -f $diffOffsets.Count, $runs.Count) -ForegroundColor Yellow
Write-Host ''

$shown = 0
foreach ($run in $runs) {
    if ($shown -ge $MaxRuns) {
        Write-Host ('... and {0} more run(s). Raise -MaxRuns to see them.' -f ($runs.Count - $shown)) -ForegroundColor DarkGray
        break
    }
    $length = $run.End - $run.Start + 1
    Write-Host ('  {0}  ({1} byte(s), {2})' -f (Format-Address $run.Start), $length, (Get-RegionName $run.Start)) -ForegroundColor Cyan
    Write-Host ('    ref  {0}' -f (Format-Hex $ref $run.Start $Context))
    Write-Host ('    act  {0}' -f (Format-Hex $act $run.Start $Context))
    $shown++
}

Write-Host ''
exit 1
