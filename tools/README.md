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

---

## Migracion de las fotos

Son **8.747 archivos** (4.810 fotos de desvio + 3.937 checklists), varios GB.

Van **de Drive directo al VPS**, sin pasar por la maquina de desarrollo: bajarlos
a Windows y despues subirlos por scp es hacer el trabajo dos veces, y scp con
miles de archivos chicos es lento y se corta.

### Que tan confiable es el matching

Cada archivo se llama `02-27-2025 10-27-45.Fotografias del desvio.135016.jpg`:
fecha, hora, que campo era y milisegundos. Medido sobre el historico completo:

```
8.747 referencias -> 8.747 rutas distintas -> 8.747 basenames distintos
0 colisiones | 8.747 de 8.747 con el formato esperado
```

No hay ambiguedad posible. El unico modo de falla es que un archivo no este, y
para eso queda `/tmp/fotos_faltantes.txt`.

### Ojo: son DOS carpetas

8.741 fotos estan en `Form Responses 1_Images`, pero **6 estan en
`Patrullas Seguridad, Calidad, 5S_Images`** (y son `.png`). Si bajas solo la
principal, esas 6 se pierden.

### Pasos

**1. En Windows** — generar el manifiesto (no necesita las fotos):

```powershell
powershell -File tools\generar_manifiesto_fotos.ps1
```

Produce `tools/fotos_manifiesto.tsv`: que archivo va a que registro y con que
ruta destino. Se commitea, asi el VPS lo tiene con un `git pull`.

**2. En el VPS** — traer las fotos con rclone:

```bash
rclone copy 'gdrive:Form Responses 1_Images' /srv/fotos_appsheet -P
rclone copy 'gdrive:Patrullas Seguridad, Calidad, 5S_Images' /srv/fotos_appsheet -P
```

**3. En el VPS** — acomodarlas y enlazarlas:

```bash
bash tools/colocar_fotos.sh /srv/fotos_appsheet
```

Indexa por nombre de archivo, copia al arbol `historico/YYYY/MM/` dentro del
volumen `yard_uploads`, y aplica los `UPDATE` de ruta.

**El SQL se genera solo para los archivos que realmente se copiaron.** Si una
foto no aparece, su registro queda con `ruta` en NULL y sigue contando en
`v_fotos_pendientes`. Preferimos "no la tenemos" antes que una imagen rota.

### Por que el manifiesto se escribe con LF

Lo lee `read` de bash en el VPS. Con CRLF, el `\r` se pega al final de la ruta
destino y los archivos terminan con un retorno de carro en el nombre. El
generador fuerza LF y el script de bash ademas lo limpia por las dudas.
