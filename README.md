# Lector de bitácoras de vuelo · Datos de Occidente

Aplicación web gratuita y de código abierto que convierte la **exportación de vuelos de un dron de aspersión** en un **reporte de vuelos** imprimible o en PDF: tiempos, distancias, área y volumen (cuando el archivo los trae), trayectoria y advertencias.

Sirve para el control interno del operador y como respaldo para el cliente final. Funciona en celular y computador, sin cuentas y sin internet una vez abierta.

## Formatos

**Acepta**

- **CSV** separado por coma, punto y coma o tabulador; UTF-8 o Windows-1252; decimal con coma o punto.
- **XLSX** (Excel): hoja 1 por defecto, con selector de hoja.
- **GPX** (`trkpt` con `lat`, `lon` y `time`) y **KML** (`LineString`, `Point`, `gx:Track`; orden `lon,lat,alt`).
- Límites: 20 MB y 200.000 filas por archivo.

**No acepta** registros nativos del dron o del control (por ejemplo `.txt`, `.dat` o `.bin` cifrados). Leerlos exige llaves privadas de cada fabricante y enviar los datos a terceros. Exporta primero desde tu plataforma.

## Cómo exportar desde tu plataforma

Los pasos cambian según la marca y la versión. En general:

1. En la aplicación o el portal web de tu plataforma de vuelo, busca el historial de vuelos, de operaciones o de tareas.
2. Busca una opción de **exportar** o **descargar** (a veces se llama "registro", "reporte" o "datos de vuelo").
3. Elige **CSV, Excel (XLSX), GPX o KML**.
4. Si solo encuentras un archivo de Excel antiguo (`.xls`), ábrelo en Excel y usa **Guardar como → CSV UTF-8**.

## Tipos de archivo, mapeo y unidades

- **A · Telemetría:** filas con hora y coordenadas. Se ordenan por tiempo, se quitan duplicados y saltos imposibles (> 100 m/s) y se separan en vuelos por ID de vuelo o por una pausa sin datos (10 min por defecto, configurable de 1 a 120).
- **B · Resumen por vuelo:** una fila por vuelo, con inicio, fin o duración, área y volumen.

La app **sugiere** qué columna es cada dato a partir de su nombre (en español o inglés, sin importar tildes ni mayúsculas). Tú **confirmas o corriges** el mapeo antes de calcular. Las unidades no se asumen; las eliges por columna:

| Dato | Unidades |
|---|---|
| Velocidad | m/s, km/h |
| Área | ha, m², acres, mu (1 ha = 15 mu) |
| Volumen | L, mL, galón US (3,785411784 L) |
| Duración | s, min, h |

Las fechas sin zona horaria se muestran **tal como aparecen en el archivo**. Si el formato día/mes o mes/día es ambiguo, la app te pide elegirlo. El área cubierta **no se estima** a partir de la trayectoria, porque el traslape de pasadas la sobreestima. Si el archivo no trae área, el reporte lo indica.

## Privacidad

- Todo se procesa en tu navegador. El archivo no se sube a ningún servidor.
- No hay analítica, cookies ni almacenamiento local, y nada se guarda al cerrar la página.
- **Atención:** el reporte puede mostrar la forma y la ubicación del predio (trayectoria y coordenadas). Revísalo antes de compartirlo. Las coordenadas numéricas están desactivadas por defecto.

## Aviso legal

Herramienta de apoyo con fines informativos. Verifica siempre los datos con la plataforma de origen. Sin garantía de ningún tipo. El reporte no ha sido verificado y no constituye certificación, informe oficial ni acto administrativo.

## Pruebas

Requiere Node.js 18 o superior y no necesita instalar paquetes:

```
node --test
```

Las pruebas usan datos sintéticos creados en cada prueba.

## Publicar en GitHub Pages

1. Sube esta carpeta a un repositorio (por ejemplo `lector-bitacoras-drones`).
2. En GitHub: **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
3. Edita `js/config.js`: `urlFeedback` (WhatsApp `https://wa.me/57…` o `mailto:`) y `urlMarca`. Mientras digan `TODO_CONFIGURAR`, el botón y el enlace quedan ocultos.

También funciona abriendo `index.html` directamente desde el computador.

## Contribuir

Puedes reportar errores o proponer mejoras por medio de *issues* o *pull requests*. Lo más útil es **enviar muestras anonimizadas** de exportaciones reales (sin nombres de clientes, predios ni coordenadas reales) para mejorar la detección de columnas. Mantén el proyecto sin dependencias externas y agrega pruebas para cada cambio.

## Licencia

MIT © 2026 Datos de Occidente. Consulta [LICENSE](LICENSE).
