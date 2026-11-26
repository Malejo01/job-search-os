# Legibilidad (R30-12)

Reglas de tamaño y color de texto de la app con sesión y de las páginas públicas. Salen del informe de revisión (S-33 a S-42) y del plan R30 a R34 §9. Los valores viven en `apps/web/app/globals.css`; la regla que falla está en `apps/web/lib/legibilidad.ts` y se corre en `apps/web/test/legibilidad.test.ts`. Los colores y radios generales siguen en `docs/ux/tokens.md`.

## Tamaños

| Token | Clase | Valor | Para qué |
|---|---|---|---|
| `--text-body` | `text-body` (igual a `text-base`) | 16 px / 24 | Cuerpo: todo lo que hay que leer para decidir |
| `--text-secondary` | `text-secondary` (igual a `text-sm`) | 14 px / 20 | Secundario: aclaraciones, etiquetas de campos. **Mínimo para lo necesario para decidir** |
| `--text-meta` | `text-meta` (igual a `text-xs`) | 12 px / 16 | Solo metadatos que se pueden ignorar: fecha, fuente, nota al pie |
| `--text-heading` | `text-heading` | 18 px / 28 | `h2` de sección |
| `--text-title` | `text-title` | 24 px / 30 | `h1` de pantalla |

**Nada debajo de 12 px.** Los sellos y los chips también: 12 px o más. Un tamaño arbitrario (`text-[13px]`) pasa si llega a 12 px; `text-[11px]` falla.

## Colores de texto

| Rol | Clase | Claro | Oscuro | Para qué |
|---|---|---|---|---|
| Primario | `text-fg` | `#14123A` | `#F5F5F7` | Títulos y todo lo necesario para decidir |
| Secundario | `text-fg-muted` | `#3F3F46` | `#D4D4E0` | Texto de apoyo |
| Terciario o deshabilitado | `text-fg-subtle` | `#52525B` | `#A9A8C8` | Lo que se puede ignorar y lo deshabilitado. **No** va en lo necesario para decidir ni en 12 px |

Además de esos tres, la lista permitida (`COLORES_DE_TEXTO` en `legibilidad.ts`) incluye los de acción y estado (`text-link`, `text-brand-text`, `text-success`, `text-warning`, `text-danger`, `text-info`) y los que dependen del fondo: `text-brand-contrast` y `text-brand` (sobre lima o índigo), `text-ink`, `text-canvas`, `text-on-ink`, `text-on-ink-muted` y `text-on-strong`. Todos pasan AA (4,5:1) sobre su fondo en los dos modos.

**Sin transparencias en textos.** Ni `text-fg/70` ni `opacity-60` en algo que lleva texto: bajan el contraste sin que nadie lo mida. Para un gris más suave se usa `text-fg-subtle`; para un botón deshabilitado, el atributo `disabled` con `text-fg-subtle` sobre `surface-muted`. (`opacity-0` pasa: oculta el elemento por completo.)

Los ejemplos de un campo vacío (placeholder) se distinguen de lo cargado: `placeholder:text-fg-subtle`, y lo cargado en `text-fg`.

## La regla

`auditarLegibilidad(código)` devuelve, por archivo, lo que no cumple: `tamano_menor_12`, `color_fuera_de_lista`, `texto_transparente` y `opacidad`.

- **Pantallas de ofertas** (listado, tarjeta, detalle y evaluación): modo estricto. Un archivo nuevo o un cambio que sume un hallazgo hace fallar `test/legibilidad.test.ts` con el archivo, la línea y el fragmento.
- **Resto de las pantallas de usuario:** `EXCEPCIONES` en el test, con cuántos hallazgos tiene hoy cada archivo. Solo pueden bajar; la R33 (CV) y la R34 (el resto) las van vaciando hasta dejar la lista vacía. El admin queda afuera hasta después de abrir.
- **Excluidos con motivo:** `components/cv-preview.tsx` (emula papel: fondo blanco y texto oscuro fijos), `app/global-error.tsx` (CSS propio) y `app/(app)/admin/`.

## Auditoría de lo que se ve

El spec `apps/web/e2e/340-auditoria-legibilidad.spec.ts` recorre las pantallas de ofertas en claro y oscuro, a 390 y 1280 px y con zoom al 200 %, y deja capturas de lo que no cumple en `ops/capturas/r30/legibilidad/`. Mide en el navegador lo que la regla de código no ve: el tamaño calculado de cada texto (nada menor a 12 px), la opacidad calculada (nada menor a 1 en un texto) y el contraste que mide axe. Lo corre el lead; el resumen va al informe de la tanda, para la revisión de diseño. Una persona de diseño revisa esa lista después.
