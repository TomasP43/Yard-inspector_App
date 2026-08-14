# tools

## `etl_appsheet.ps1`

Genera `migrations/003_datos_historicos.sql` a partir de la planilla de AppSheet
(`Patrulla Calidad, Seguridad, 5s (Responses).xlsx`, hoja **Form Responses 1**).

Corre en Windows con Excel instalado (usa COM para leer el .xlsx). Se ejecuta
una sola vez, pero es idempotente: el `uuid` de cada inspeccion es un md5 de
fila + timestamp, y como la columna es UNIQUE, volver a cargar el SQL no
duplica nada.

```powershell
powershell -File tools\etl_appsheet.ps1
```

### Por que el script es 100% ASCII

PowerShell 5.1 lee los `.ps1` **sin BOM como ANSI, no UTF-8**. Cualquier literal
acentuado dentro del script se corrompe solo: `Óxido` (bytes UTF-8 `C3 93`) se
convierte en `Ã“xido`. Eso ya genero tres desvios fantasma en una version
anterior del catalogo.

Por eso el script no tiene ni un caracter no-ASCII, y **los nombres canonicos se
toman siempre del dato de origen**, nunca de un literal escrito aca. La
agrupacion se hace normalizando (minusculas, sin acentos) y el nombre que queda
es la grafia mas frecuente en la planilla.

Si vas a tocar este script, mantene esa regla.

### Que decide el ETL

| Caso | Que hace |
|---|---|
| 34 filas sin Timestamp | Se descartan (no traen ningun dato util) |
| Auditor `Almiron` | Se mapea a `almironttfa@gmail.com` |
| Auditor `llpintos98ttfa@gmail.com98ttfa@gmail.com` | Email corrupto, se mapea a `lpintos98ttfa@gmail.com` |
| Auditor `Lares` | **No hay email que le corresponda**. Se crea `lares@migrado.local` para no perder las 28 filas. Hay que reasignarlo a mano |
| Controlador `Codero` / `Fernandez` con tilde | Se fusionan con `Cordero` / `Fernandez` |
| Controlador `Controlado`, `Solicitado controlar en TASA`, `Sin firma del controlador` | No son personas: van a `estado_control` |
| Equipo `0` | El campo arranca en 0 en AppSheet, asi que significa "sin cargar" -> NULL |
| Equipos `1, 2, 3, 7, 14, 63, 16666, 78516` | Fuera del rango habitual. Se migran tal cual: no hay forma de saber cual era el correcto |
| Fotos | Se registra `ruta_origen` (la ruta en Drive) con `ruta` en NULL: los archivos todavia no se copiaron |
