$ErrorActionPreference = 'Stop'
# ============================================================================
# ETL: Form Responses 1 (AppSheet) -> migrations/003_datos_historicos.sql
#
# 100% ASCII a proposito. PS 5.1 lee los .ps1 sin BOM como ANSI y corrompe
# cualquier literal acentuado; los nombres canonicos salen SIEMPRE del dato.
# ============================================================================
$scratch = "C:\Users\tpozo\AppData\Local\Temp\claude\C--Users-tpozo-Yard-inspector-App\3d17359e-8c72-4063-8238-75712e114783\scratchpad"
$proj    = "C:\Users\tpozo\Yard inspector_App"
$src     = "C:\Users\tpozo\OneDrive - TOYOTA TRANSPORT FURLONG ARGENTINA SA\Escritorio\Patrulla Calidad, Seguridad, 5s (Responses).xlsx"
$outSql  = Join-Path $proj "migrations\003_datos_historicos.sql"

function Get-Slug([string]$s) {
  $n = $s.Trim().ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD)
  $sb = New-Object Text.StringBuilder
  foreach ($ch in $n.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -ne [Globalization.UnicodeCategory]::NonSpacingMark) { [void]$sb.Append($ch) }
  }
  ($sb.ToString() -replace '\s+', ' ').Trim()
}
function Q([string]$s) { "'" + ($s -replace '\\', '\\\\' -replace "'", "''") + "'" }
function NullOr($v) { if ($null -eq $v -or "$v" -eq '') { 'NULL' } else { $v } }

# ---------------------------------------------------------------- leer origen
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
$wb = $xl.Workbooks.Open($src, 0, $true)
$ws = $wb.Worksheets.Item("Form Responses 1")
$arr = $ws.Range("A2:M4053").Value2
$wb.Close($false); $xl.Quit()
[Runtime.InteropServices.Marshal]::ReleaseComObject($ws) | Out-Null
[Runtime.InteropServices.Marshal]::ReleaseComObject($wb) | Out-Null
[Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null

# C1 Timestamp C2 Fecha C3 Auditor C4 Responsable C5 Tipo C6 Equipo
# C7 Resultado C8 Desvio C9 Demora C10 Foto1 C11 FotoChecklist C12 Foto3 C13 Controlador

# --------------------------------------------------------------- normalizado
# Auditores: la columna mezcla emails con apellidos sueltos.
$auditorMap = @{
  'lpintos98ttfa@gmail.com'                  = 'lpintos98ttfa@gmail.com'
  'llpintos98ttfa@gmail.com98ttfa@gmail.com' = 'lpintos98ttfa@gmail.com'  # email corrupto
  'almironttfa@gmail.com'                    = 'almironttfa@gmail.com'
  'almiron'                                  = 'almironttfa@gmail.com'
  'mcamejottfasa@gmail.com'                  = 'mcamejottfasa@gmail.com'
  'tpozo@ttfasa.com'                         = 'tpozo@ttfasa.com'
  # No hay ningun email en el historico que corresponda a "Lares": se crea un
  # usuario provisorio para no perder las 28 filas. Hay que reasignarlo a mano.
  'lares'                                    = 'lares@migrado.local'
}
$auditorNombre = @{ 'lares@migrado.local' = 'Lares' }

# Controlador: separar personas de estados
$controlEstados = @{
  'solicitado controlar en tasa' = 'Solicitado controlar en TASA'
  'controlado'                   = 'Controlado'
  'sin firma del controlador'    = 'Sin firma del controlador'
}
$controlPersona = @{
  'feria' = 'Feria'; 'cordero' = 'Cordero'; 'codero' = 'Cordero'
  'nores' = 'Nores'; 'fernandez' = 'Fernandez'; 'zecca' = 'Zecca'
  'barrientos' = 'Barrientos'; 'velarde' = 'Velarde'
}

$desvioSemantic = @{
  'batea oxidada'               = 'oxido en batea'
  'suciedad avanzada'           = 'suciedad avanzada en batea'
  'batea con suciedad avanzada' = 'suciedad avanzada en batea'
  'zunchos sin acomodar'        = 'sunchos sin acomodar'
  'oxido y suciedad avanzada'   = 'oxido y suciedad avanzada en batea'
}
# slug -> nombre canonico, reconstruido igual que en el seed del catalogo
$canon = @{}
for ($i = 1; $i -le $arr.GetLength(0); $i++) {
  $dv = [string]$arr[$i, 8]
  if (-not $dv -or $dv.Trim() -eq '') { continue }
  foreach ($p in ($dv -split ',')) {
    $o = $p.Trim(); if ($o -eq '') { continue }
    $s = Get-Slug $o
    if ($desvioSemantic.ContainsKey($s)) { $s = $desvioSemantic[$s] }
    if (-not $canon.ContainsKey($s)) { $canon[$s] = @{} }
    $canon[$s][$o] = [int]$canon[$s][$o] + 1
  }
}
$slugToNombre = @{}
foreach ($k in $canon.Keys) {
  $slugToNombre[$k] = ($canon[$k].GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
}

# ------------------------------------------------------------------ recorrer
$sqlIns = New-Object Collections.Generic.List[string]
$usuarios = @{}; $equipos = @{}
$stats = @{ filas=0; saltadas=0; ok=0; ng=0; desvios=0; fotos=0; checklist=0; sinEquipo=0; sinDesvio=0; equipoCero=0 }
$md5 = [Security.Cryptography.MD5]::Create()

for ($i = 1; $i -le $arr.GetLength(0); $i++) {
  $ts = $arr[$i, 1]
  # Las 34 filas sin Timestamp son basura: no traen ningun campo util.
  if ($null -eq $ts -or "$ts" -eq '') { $stats.saltadas++; continue }
  $stats.filas++

  $fecha = if ($ts -is [double]) { [DateTime]::FromOADate($ts) } else { [DateTime]::Parse([string]$ts, [Globalization.CultureInfo]::GetCultureInfo('en-US')) }
  $fechaSql = $fecha.ToString('yyyy-MM-dd HH:mm:ss')

  $resultado = ([string]$arr[$i, 7]).Trim()
  if ($resultado -ne 'OK' -and $resultado -ne 'NG') { $stats.saltadas++; $stats.filas--; continue }
  if ($resultado -eq 'OK') { $stats.ok++ } else { $stats.ng++ }

  # uuid determinista: reejecutar el ETL no duplica (uuid es UNIQUE)
  $hash = $md5.ComputeHash([Text.Encoding]::UTF8.GetBytes("appsheet|$i|$fechaSql"))
  $h = ($hash | ForEach-Object { $_.ToString('x2') }) -join ''
  $uuid = "$($h.Substring(0,8))-$($h.Substring(8,4))-$($h.Substring(12,4))-$($h.Substring(16,4))-$($h.Substring(20,12))"

  $audRaw = ([string]$arr[$i, 3]).Trim()
  $audKey = $audRaw.ToLowerInvariant()
  $email = if ($auditorMap.ContainsKey($audKey)) { $auditorMap[$audKey] } else { $audKey }
  $usuarios[$email] = $true

  $resp = ([string]$arr[$i, 4]).Trim()
  $tipo = ([string]$arr[$i, 5]).Trim()
  $demora = ([string]$arr[$i, 9]).Trim()

  # El campo Equipo en AppSheet arranca en 0 (stepper con valor inicial 0), asi
  # que un 0 significa "no lo cargaron", no el camion numero cero.
  $eq = $arr[$i, 6]
  $eqCod = $null
  if ($null -ne $eq -and "$eq" -ne '') {
    $tmp = [int][double]$eq
    if ($tmp -gt 0) { $eqCod = $tmp; $equipos[$eqCod] = $true }
    else { $stats.sinEquipo++; $stats.equipoCero++ }
  } else { $stats.sinEquipo++ }

  # controlador vs estado de control
  $ctrlRaw = ([string]$arr[$i, 13]).Trim()
  $ctrlSlug = Get-Slug $ctrlRaw
  $ctrlNom = $null; $estadoNom = $null
  if ($ctrlRaw -ne '') {
    if ($controlPersona.ContainsKey($ctrlSlug)) { $ctrlNom = $controlPersona[$ctrlSlug] }
    elseif ($controlEstados.ContainsKey($ctrlSlug)) { $estadoNom = $controlEstados[$ctrlSlug] }
  }

  # El CHECK exige tipo NOT NULL en NG y NULL en OK
  $tipoSql = 'NULL'
  if ($resultado -eq 'NG') {
    if ($tipo -eq '') { $stats.saltadas++; $stats.filas--; $stats.ng--; continue }
    $tipoSql = "(SELECT id FROM tipo_desvio WHERE nombre=$(Q $tipo))"
  }

  $respSql   = if ($resp -eq '') { 'NULL' } else { "(SELECT id FROM responsable WHERE nombre=$(Q $resp))" }
  $eqSql     = if ($null -eq $eqCod) { 'NULL' } else { "(SELECT id FROM equipo WHERE codigo=$eqCod)" }
  $demoraSql = if ($resultado -eq 'NG' -and $demora -ne '') { "(SELECT id FROM demora WHERE nombre=$(Q $demora))" } else { 'NULL' }
  $ctrlSql   = if ($ctrlNom) { "(SELECT id FROM controlador WHERE nombre=$(Q $ctrlNom))" } else { 'NULL' }
  $estSql    = if ($estadoNom) { "(SELECT id FROM estado_control WHERE nombre=$(Q $estadoNom))" } else { 'NULL' }

  $fchk = ([string]$arr[$i, 11]).Trim()
  $fchkSql = if ($fchk -eq '') { 'NULL' } else { Q $fchk }
  if ($fchk -ne '') { $stats.checklist++ }

  $sqlIns.Add("INSERT INTO inspeccion (uuid,origen,registrado_en,auditor_id,responsable_id,equipo_id,resultado,tipo_desvio_id,demora_id,controlador_id,estado_control_id,foto_checklist,foto_checklist_origen) VALUES ($(Q $uuid),'appsheet',$(Q $fechaSql),(SELECT id FROM usuario WHERE email=$(Q $email)),$respSql,$eqSql,$(Q $resultado),$tipoSql,$demoraSql,$ctrlSql,$estSql,NULL,$fchkSql);")
  $sqlIns.Add("SET @i = LAST_INSERT_ID();")

  if ($resultado -eq 'NG') {
    $dv = ([string]$arr[$i, 8]).Trim()
    $nombres = @()
    if ($dv -ne '') {
      foreach ($p in ($dv -split ',')) {
        $o = $p.Trim(); if ($o -eq '') { continue }
        $s = Get-Slug $o
        if ($desvioSemantic.ContainsKey($s)) { $s = $desvioSemantic[$s] }
        if ($slugToNombre.ContainsKey($s)) { $nombres += $slugToNombre[$s] }
      }
    }
    $nombres = $nombres | Select-Object -Unique
    if ($nombres.Count -eq 0) { $stats.sinDesvio++ }
    foreach ($n in $nombres) {
      $sqlIns.Add("INSERT INTO inspeccion_desvio (inspeccion_id,desvio_id) SELECT @i,id FROM desvio_catalogo WHERE nombre=$(Q $n);")
      $stats.desvios++
    }
  }

  # Foto 1 = "Tomar esta fotografia en horizontal" (obligatoria en NG)
  # Foto 3 = adicional opcional. La 2 es el checklist y va en la inspeccion.
  $f1 = ([string]$arr[$i, 10]).Trim()
  $f3 = ([string]$arr[$i, 12]).Trim()
  if ($f1 -ne '') { $sqlIns.Add("INSERT INTO inspeccion_foto (inspeccion_id,orden,ruta,ruta_origen,orientacion) VALUES (@i,1,NULL,$(Q $f1),'horizontal');"); $stats.fotos++ }
  if ($f3 -ne '') { $sqlIns.Add("INSERT INTO inspeccion_foto (inspeccion_id,orden,ruta,ruta_origen,orientacion) VALUES (@i,2,NULL,$(Q $f3),'libre');"); $stats.fotos++ }
}

# ------------------------------------------------------------------ armar sql
$head = New-Object Collections.Generic.List[string]
$head.Add("-- ============================================================================")
$head.Add("-- Datos historicos migrados desde AppSheet (Form Responses 1).")
$head.Add("-- Generado automaticamente. No editar a mano.")
$head.Add("--")
$head.Add("-- Filas de origen: 4052 | migradas: $($stats.filas) | descartadas: $($stats.saltadas)")
$head.Add("-- OK: $($stats.ok) | NG: $($stats.ng) | vinculos de desvio: $($stats.desvios)")
$head.Add("-- fotos referenciadas: $($stats.fotos) | checklist: $($stats.checklist)")
$head.Add("--")
$head.Add("-- Las fotos se registran con ruta=NULL y ruta_origen=<ruta en Drive>:")
$head.Add("-- los archivos todavia no se copiaron. Ver v_fotos_pendientes.")
$head.Add("--")
$head.Add("-- El uuid es determinista (md5 de fila+timestamp): volver a correr esto")
$head.Add("-- no duplica, porque uuid es UNIQUE.")
$head.Add("-- ============================================================================")
$head.Add("")
$head.Add("SET NAMES utf8mb4;")
$head.Add("SET autocommit = 0;")
$head.Add("START TRANSACTION;")
$head.Add("")
$head.Add("-- Usuarios que aparecen como Auditor en el historico")
foreach ($e in ($usuarios.Keys | Sort-Object)) {
  $nom = if ($auditorNombre.ContainsKey($e)) { Q $auditorNombre[$e] } else { 'NULL' }
  $head.Add("INSERT IGNORE INTO usuario (email,nombre,rol) VALUES ($(Q $e),$nom,'inspector');")
}
$head.Add("")
$head.Add("-- Equipos (camiones) vistos en el historico: $($equipos.Count)")
$head.Add("-- El codigo 0 se descarta: en AppSheet el campo arranca en 0, asi que")
$head.Add("-- significa 'sin cargar' ($($stats.equipoCero) fila/s).")
$raros = $equipos.Keys | Where-Object { $_ -lt 100 -or $_ -gt 9999 } | Sort-Object
if ($raros.Count -gt 0) {
  $head.Add("--")
  $head.Add("-- REVISAR: codigos fuera del rango habitual (3-4 digitos). Se migran tal")
  $head.Add("-- cual porque no hay forma de saber cual era el correcto:")
  $head.Add("--   " + ($raros -join ', '))
}
foreach ($c in ($equipos.Keys | Sort-Object)) { $head.Add("INSERT IGNORE INTO equipo (codigo) VALUES ($c);") }
$head.Add("")

$tail = @("", "COMMIT;", "", "-- Verificacion rapida:", "--   SELECT origen, resultado, COUNT(*) FROM inspeccion GROUP BY origen, resultado;", "--   SELECT COUNT(*) FROM v_fotos_pendientes;")

$todo = New-Object Collections.Generic.List[string]
$todo.AddRange($head); $todo.AddRange($sqlIns); $todo.AddRange([string[]]$tail)
[IO.File]::WriteAllLines($outSql, $todo, (New-Object Text.UTF8Encoding($false)))

"filas migradas   = " + $stats.filas
"filas descartadas= " + $stats.saltadas
"  OK             = " + $stats.ok
"  NG             = " + $stats.ng
"usuarios         = " + $usuarios.Count
"equipos          = " + $equipos.Count
"vinculos desvio  = " + $stats.desvios
"NG sin desvio    = " + $stats.sinDesvio
"filas sin equipo = " + $stats.sinEquipo
"fotos desvio     = " + $stats.fotos
"fotos checklist  = " + $stats.checklist
"lineas SQL       = " + $todo.Count
