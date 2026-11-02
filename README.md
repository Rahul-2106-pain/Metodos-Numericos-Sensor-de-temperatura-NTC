# Estimación de temperatura para ECU automotriz (NTC + métodos numéricos)

Página web interactiva del proyecto de **Métodos Numéricos**. Simula la cadena completa de una ECU:

```
NTC 10 kΩ → divisor de tensión → Vout → ADC 10 bits (0–1023) → tabla de calibración → interpolación → acción de la ECU
```

Todo corre en el navegador (HTML + CSS + JavaScript puro), sin instalar nada.

## Estado del proyecto

| Fase | Contenido | Estado |
|------|-----------|--------|
| 1 | Tablero, entrada de datos (slider, ADC, voltaje), tabla por ecuación Beta o archivo Excel, animación del ADC de 10 bits, búsqueda en la tabla | ✅ Lista |
| 2 | Interpolación: Lagrange, diferencias divididas de Newton, método matricial, splines cúbicos (grado 2 o 3 para los polinomios) | ✅ Lista |
| 3 | Raíces: bisección, Newton-Raphson, secante sobre la ecuación Beta, con tablas de iteración y gráfica de convergencia | ✅ Lista |
| 4 | Curva de calibración con punto en vivo (arrastrable), panel de actuación de la ECU con luces testigo, estado de falla del sensor | ✅ Lista |

## Cómo usarla

1. Abre `index.html` con doble clic (o sirve la carpeta: `python3 -m http.server` y entra a `http://localhost:8000`).
2. Mueve el deslizador o escribe un código ADC / voltaje: el tablero y la búsqueda en la tabla se actualizan al instante.
3. Pulsa **Convertir y buscar** para ver la animación paso a paso (muestreo → aproximaciones sucesivas bit a bit → comparación con la tabla).
4. Para usar tus propios nodos, arrastra un archivo Excel a la zona de carga.
5. En la sección 06 puedes arrastrar sobre la curva para cambiar la lectura y ver cómo responde la ECU.

### Tabla de calibración

Hay tres orígenes:

- **Ecuación Beta cada 10 °C / cada 5 °C:** se calculan en la página para cada temperatura de −20 a 120 °C:
  1. `R_NTC = R25 · exp[β (1/(T+273.15) − 1/298.15)]` (NTC de 10 kΩ, β = 3965 K).
  2. `Vout = 5 V · Rfija / (R_NTC + Rfija)` (divisor con R fija de 10 kΩ).
  3. `N = ⌊Vout / 5 × 1024⌋` (ADC de 10 bits).

  Son el **modelo ideal** del circuito con valores nominales, no una medición.
- **Mis datos (Excel):** arrastra un archivo `.xlsx` o `.xls`. Se leen las **dos primeras columnas numéricas**: columna 1 = código ADC (o voltaje), columna 2 = temperatura en °C. La primera fila de texto se toma como encabezado y se usa para detectar el orden de las columnas y si la primera es voltaje. Se necesitan al menos 3 nodos con ADC distintos. Hay una plantilla en `data/plantilla_calibracion.xlsx`.
- Solo se aceptan archivos Excel. La lectura usa la librería SheetJS incluida en `js/vendor/` (Apache-2.0), así que funciona sin internet.

## Configuración

Todo lo editable está en `js/config.js`:

- Nombres de integrantes y docente.
- Parámetros del circuito (Vcc, R fija, R25, β) y **dónde está el NTC** (`ntcPosicion`): `'arriba'` (NTC a +5 V, como dice el informe; el ADC sube al calentarse) o `'abajo'` (NTC a tierra; el ADC baja al calentarse). Para saberlo en el prototipo, calienta el NTC con los dedos y observa el ADC.
- Zonas de la ECU (valores típicos de un motor convencional; cambian según el fabricante): **menos de 70 °C** calentamiento (enriquecimiento, ralentí elevado), **70–100 °C** normal, **100–110 °C** ventilador activo, **más de 110 °C** sobrecalentamiento. Las salidas de cada zona son ilustrativas.
- Si N ≤ 20 o N ≥ 1003 se considera falla del sensor (cortocircuito o circuito abierto).

## Estructura

```
index.html          página principal
css/style.css       estilo de tablero
js/config.js        datos del proyecto y umbrales
js/core.js          lógica pura: ADC, ecuación Beta, lectura de tablas, búsqueda
js/methods.js       métodos de interpolación (Lagrange, Newton, matricial, splines)
js/roots.js         métodos de raíces (bisección, Newton-Raphson, secante)
js/gauges.js        medidores de aguja (SVG)
js/vendor/          librería SheetJS para leer Excel (incluida, sin CDN)
js/app.js           interfaz y animaciones
data/               plantilla de Excel con 15 nodos de ejemplo
tests/              pruebas de la lógica (node tests/core.test.js, methods.test.js, roots.test.js)
```

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub y sube todo el contenido de esta carpeta a la rama `main`.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. Espera un minuto: la página quedará en `https://<usuario>.github.io/<repositorio>/`.

## Pruebas

```
node tests/core.test.js
node tests/methods.test.js
node tests/roots.test.js
```
