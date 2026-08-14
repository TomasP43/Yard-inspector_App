param(
  [string]$Salida = "$PSScriptRoot\fotos_manifiesto.tsv"
)
$ErrorActionPreference = 'Stop'
# ============================================================================
# Genera el manifiesto de fotos historicas: que archivo de AppSheet va a que
# registro y con que ruta destino.
#
# NO necesita las fotos: sale todo de la planilla. Los archivos se bajan de
# Drive directo al VPS con rclone y los acomoda tools/colocar_fotos.sh.
#
# 100% ASCII: PS 5.1 lee los .ps1 sin BOM como ANSI. Ver tools/README.md.
#
# El uuid se recalcula EXACTAMENTE igual que en etl_appsheet.ps1 (md5 de
# "appsheet|fila|timestamp"). Si cambia una formula y la otra no, los UPDATE
# del VPS no encuentran nada. Por eso los dos scripts viven juntos.
# ============================================================================

$src = "C:\Users\tpozo\OneDrive - TOYOTA TRANSPORT FURLONG ARGENTINA SA\Escritorio\Patrulla Calidad, Seguridad, 5s (Responses).xlsx"

Write-Host "Leyendo la planilla ..."
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
$wb = $xl.Workbooks.Open($src, 0, $true)
$arr = $wb.Worksheets.Item("Form Responses 1").Range("A2:M4053").Value2
$wb.Close($false); $xl.Quit()
[Runtime.InteropServices.Marshal]::ReleaseComObject($wb) | Out-Null
[Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null

$md5 = [Security.Cryptography.MD5]::Create()
$filas = New-Object Collections.Generic.List[string]
# uuid \t tipo \t basename \t ruta_origen \t destino
$filas.Add("uuid`ttipo`tbasename`truta_origen`tdestino")

$n = 0
for ($i = 1; $i -le $arr.GetLength(0); $i++) {
  $ts = $arr[$i, 1]
  if ($null -eq $ts -or "$ts" -eq '') { continue }
  $resultado = ([string]$arr[$i, 7]).Trim()
  if ($resultado -ne 'OK' -and $resultado -ne 'NG') { continue }
  # misma exclusion que el ETL: un NG sin tipo no se migro
  if ($resultado -eq 'NG' -and ([string]$arr[$i, 5]).Trim() -eq '') { continue }

  $fecha = if ($ts -is [double]) { [DateTime]::FromOADate($ts) } else { [DateTime]::Parse([string]$ts, [Globalization.CultureInfo]::GetCultureInfo('en-US')) }
  $fechaSql = $fecha.ToString('yyyy-MM-dd HH:mm:ss')
  $hash = $md5.ComputeHash([Text.Encoding]::UTF8.GetBytes("appsheet|$i|$fechaSql"))
  $h = ($hash | ForEach-Object { $_.ToString('x2') }) -join ''
  $uuid = "$($h.Substring(0,8))-$($h.Substring(8,4))-$($h.Substring(12,4))-$($h.Substring(16,4))-$($h.Substring(20,12))"

  # col 10 = foto del desvio (horizontal), 12 = adicional, 11 = checklist batea
  foreach ($par in @(@(10, 'foto'), @(12, 'foto'), @(11, 'checklist'))) {
    $ruta = ([string]$arr[$i, $par[0]]).Trim()
    if ($ruta -eq '') { continue }

    $base = [IO.Path]::GetFileName($ruta)
    # Mismo esquema YYYY/MM que fotoService usa para las fotos nuevas, bajo
    # historico/ para distinguirlas de un vistazo dentro del volumen.
    $sub = "historico/{0:yyyy}/{0:MM}" -f $fecha
    $nombre = $base -replace '[^a-zA-Z0-9._-]', '_'
    $destino = "$sub/$nombre"

    $filas.Add("$uuid`t$($par[1])`t$base`t$ruta`t$destino")
    $n++
  }
}

# LF explicito: WriteAllLines usa CRLF en Windows y este archivo lo lee `read`
# de bash en el VPS, que dejaria un \r pegado al final de cada ruta destino.
[IO.File]::WriteAllText($Salida, (($filas -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
"fotos en el manifiesto = $n"
"archivo                = $Salida"
""
"Siguiente paso: copiar el manifiesto al VPS y correr alli tools/colocar_fotos.sh"
