# C10 · Brechas entre C9 y las referencias aprobadas

Plan de trabajo de la tanda C10 (fidelidad visual). Se armó corriendo el e2e 120 (`apps/web/e2e/120-comparar-referencias.spec.ts`) sobre `ronda/integracion-c9` tal como la dejó C9 (`3edc722` + las referencias), con los datos de Lucía (`apps/web/e2e/c10/lucia.ts`), y mirando cada «referencia | real» lado a lado. Las medidas exactas salen de `referencias/S1-publicas.html` y `S2-hoy-ofertas.html`; ante la duda manda ese código.

Cómo regenerar las comparaciones: `pnpm --filter @job-search-os/web exec playwright test e2e/120-comparar-referencias.spec.ts` con la base local (o el artefacto «comparaciones» del job e2e del CI). Quedan en `apps/web/e2e/__comparaciones__/` (ignorado por git).

## Lo que se repite en todas (primitivas y navegación → C10-2 y C10-3)

| Pieza | Referencia | C9 hoy |
|---|---|---|
| Logo | Monograma «A» lima con el punto blanco (30 px en PC, 24 en celular) + «AfinIA» Bricolage 800 lima y «Jobs» 500 blanco, 26/21 px, tracking −0,8 px, **sin punto final** | Sin monograma; logotipo con punto lima al final («AfinIAJobs.») |
| Barra con sesión (PC) | Índigo, padding 18×48 (14×48 en Ofertas); logo, píldoras Hoy · Ofertas · Postulaciones · Mi CV · Perfil (14 px 700 `#C7C6E6`, 9×16, activa lima con texto índigo) y avatar 40 px `#4338CA` a la derecha | Siete píldoras (Sin descripción, Emails, Mercado, Plan…), «Ajustes» y «Salir» en texto, avatar chico índigo oscuro |
| Barra con sesión (celular) | Índigo con logo + avatar 34 px `#4338CA`; nada más | Logo + «Ajustes» + «Salir» + avatar |
| Pestañas del celular | Barra **blanca**, borde superior 2 px `#E4E4EA`, padding 8/8/22; pestaña 72 px, texto 11 px 700 `#52525B`; la activa con el ícono dentro de una píldora lima 44×28 y el texto índigo | Barra **índigo**; la activa es un bloque lima grande que tapa ícono y texto |
| Barra sin sesión | Logo + píldoras Cómo funciona · Precios · Ayuda + «Entrar» blanco + botón lima «Anotarme a la beta» (44 px, 15 px) | Mercado · Ofertas · Demo · Ya tengo cuenta + «Pedir acceso»; en el celular «Entrar» + «Pedir acceso» (la referencia lleva solo «Entrar») |
| Tarjeta destacada `.card` | Blanca, radio 24, borde 2 px `#D4D4DC` y **6 px abajo** | Sin borde lateral visible; borde de abajo gris; padding mayor |
| Tarjeta de lista `.cardl` | Radio 24, borde 2 px `#E4E4EA` y 4 px abajo | Sin borde lateral |
| Chips de requisito | `.ok` `#ECFDF5`/`#064E3B` con «✓» y `.fa` `#FFFBEB`/`#78350F` con «!» y el texto «Te falta: …»; 12 px 700, 4×10 | Ámbar con «+», sin «Te falta:»; chip gris extra «y 2 más» |
| Línea de conteo | Una sola línea 12 px 600 `#52525B`: «4 a tu favor, 1 te falta · Presencial · hace 2 días» | Dos líneas: conteo en negrita y «Presencial. Publicada hace 2 días» aparte |
| Sello | Círculo; número Bricolage 800 y palabra Figtree 800; «Muy afín» lima, −8°, anillo 2 px índigo (`inset`); 60–62 lista, 72 destacada, 78 detalle cel, 88 detalle PC; número 18/19/22/24/27 px y palabra 9/10/11 px | Forma bien; tamaños y proporción de letra no siguen la tabla; en Hoy lleva «Aplicar»/«Guardar» debajo |
| Botón principal `.btn` | Lima, texto índigo 800, `inset 0 -5px 0 #8FB82E`, sin borde; 54–56 px en acciones, 44 en barras | Cerca; alturas y tamaños de letra distintos según pantalla |
| Botón secundario `.btn2` | Blanco, borde 2 px índigo y 5 px abajo | Borde gris en varios lugares («Ver guía», «Cerrar») |
| Chips de filtro `.chip` | Borde 2 px `#D4D4DC` + 4 abajo, 8×14, 13 px 700; activo lima con borde índigo | En Ofertas no hay chips: hay selects |
| Campos `.field` / `.fl` | Radio 18, borde 2 px `#D4D4DC` + 4 abajo, 13×16, 15 px 600; etiqueta 13 px 800 arriba | Borde 2 px `#71717A` parejo, etiqueta 14 px 600 |
| Checks | Hecho: círculo lima 26 px con «✓» índigo; pendiente: aro 3 px `#4338CA` | Hecho: verde suave 36 px; pendiente: aro punteado |

## Por pantalla

### 1. Portada PC (`portada-pc.png`, 1280) → C10-4
- Falta todo el bloque de la referencia: badge blanco «Beta cerrada · abre el 26 de noviembre» (13 px 800 `#4338CA`), titular 62 px 800 (lh 1,02, −2 px) sobre el **lavanda**, bajada 19 px `#3F3F46`, botones «Anotarme a la beta» (56) y «Ver una oferta de ejemplo» (`.btn2`, 56).
- C9 pone el héroe en un bloque índigo redondeado con otro titular («Leemos cada oferta…») y la bajada «Ofertas afines. CV afinado.».
- A la derecha: panel blanco radio 32, padding 22, **rotado 1,5°**, con dos tarjetas (destacada 8,5 de 72 px y lista 7,4 de 62 px). C9 muestra una sola tarjeta sin rotar, con otro puntaje (9,2).
- Abajo: 3 tarjetas `.cardl` en grilla con check lima numerado + título Bricolage 17 px 700 + texto 14 px. C9 tiene «Cómo funciona» con círculos índigo y además «Lo que prometemos» (no está en la referencia).
- Navegación: ver arriba.

### 2. Portada celular (`portada-cel.png`, 390) → C10-4
- Badge «Beta cerrada · abre el 26/11» (12 px), titular 36 px sobre lavanda, bajada 16 px corta, botón lima a todo el ancho (54 px).
- Panel blanco radio 32 con una tarjeta destacada (chips cortos «Sueldos», «IVA», «Tango», sello 60).
- 3 pasos en lista simple (check lima + 14 px 700), sin tarjetas.
- C9: bloque índigo, dos links («Ver una demo», «Ya tengo cuenta»), tarjeta con chips largos que se apilan.

### 3. /acceso PC (`acceso-pc.png`) → C10-5
- Cabecera índigo curva (radio 56 abajo) que **incluye la barra** (logo + «Entrar»); titular «Anotate para la beta de AfinIAJobs» 54 px blanco; bajada 18 px `#C7C6E6` terminada en «El cupo es limitado.»; a la derecha el lugar de la ilustración «acceso» (360×270).
- Tarjeta `.card` de 760 px centrada que se monta sobre la cabecera (margen −92 px): nombre y email en dos columnas, carreras como **chips** (no select), botones «Anotarme» (56) + «Pasáselo a alguien» (`.btn2`, 50) y «Te escribimos si hay lugar.» a la derecha.
- C9: barra normal + bloque índigo chico con «Ofertas afines. CV afinado.» y una lista de checks; formulario largo debajo, sobre el lavanda, con select de carrera y «¿Cómo te enteraste?» visible.

### 4. /acceso celular (`acceso-cel.png`) → C10-5
- Cabecera curva (radio 40) con logo, ilustración (170 px de alto) arriba del título, «Anotate para la beta» 31 px y bajada 15 px.
- Tarjeta con margen −56 px, campos apilados, chips de carrera (3 + «+3»), «Anotarme» a todo el ancho.
- C9: ver PC; además «Pedir acceso» en la barra.

### 5. Hoy PC (`hoy-pc.png`) → C10-6
- La cabecera curva (radio 56 abajo) **empieza en la barra**: es un solo bloque índigo con logo, píldoras y avatar, y abajo saludo 48 px + bajada 19 px a la izquierda e ilustración de 400 px a la derecha, apoyada en el borde de abajo. C9: barra aparte + bloque redondeado separado, con «HOY · miércoles…», «Primera vez por acá» e ilustración chica.
- Debajo, grilla `400px 1fr`: «Para hacer hoy» (`.cardl`, título 20 px 800, checks lima 26 px, tachado 15 px `#71717A`, botón `.btn2` «Pegar descripciones» 44 px) y a la derecha rótulos 13 px 800 `#4338CA` «La mejor de hoy» (tarjeta `.card` con sello 72) y «También para vos» (`.cardl` con sello 62).
- C9: «Tus mejores ofertas de la semana» con 3+ tarjetas, «Tu semana», «Próximos pasos», resumen, alertas, mercado, seguimiento: nada de eso está en la referencia.
- Saludo: la referencia dice «¡Buen día, Lucía!»; C9 usa el saludo según la hora («Buenas tardes»). Diferencia de dato aceptable.
- Bajada: «Hoy hay 3 ofertas…» sin negrita (C9 resalta el número).

### 6. Hoy celular (`hoy-cel.png`) → C10-6
- Cabecera curva (radio 40) con logo + avatar, saludo 28 px y bajada 14 px a la izquierda, ilustración 160 px a la derecha.
- «Para hacer hoy» compacto (sin «Elegir tus áreas» en la referencia del celular), «La mejor de hoy» 12 px y una sola tarjeta destacada; pestañas blancas abajo.
- C9: saludo 30 px en 2 líneas + fecha + «Primera vez por acá», ilustración chica, sin checklist, varias tarjetas largas.

### 7. Ofertas PC (`ofertas-pc.png`, con `?oferta=`) → C10-7 y C10-8
- Barra fina (14×48). Fila: «Tus ofertas» 28 px 800 + chips «Para revisar · n» (activo), «Guardadas · n», «Remoto», «En Salta» + «Ordenadas por afinidad» a la derecha.
- Grilla `470px 1fr`, gap 24. Lista: la elegida es `.card` con borde índigo; las demás `.cardl`; separador «Lejos de tu perfil (n)» con líneas a los costados.
- Panel `.card` (alto 640): título 26 px, sello 88, frase de cercanía Bricolage 19 px 700, barra de progreso 10 px lima, checklist `.cardl` + recuadro índigo con «Sumarlo a mi CV» (contorno lima), texto del aviso, «Postularme en el sitio del aviso» (54) + «Guardar» (`.btn2` 50).
- C9: título «Ofertas» con subtítulo, «Ver guía», «+ Cargar oferta», aviso de alertas, «Puestos sin ofertas», «En español», barra de revisadas, 5 selects de filtro, tarjetas con pulgares y badges (DEMO, Evaluada, Email…). El panel derecho es otro (cabecera + «Requisitos del aviso» en lista larga).

### 8. Ofertas celular (`ofertas-cel.png`) → C10-7
- Cabecera índigo (sin curva) con logo + avatar y «Tus ofertas» 26 px blanco; chips de filtro en una fila; 3 tarjetas (destacada con sello 60, el resto sello 56); pestañas blancas.
- C9: el mismo contenido que en PC apilado (filtros en selects, avisos), las tarjetas quedan debajo del pliegue.

### 9. Detalle celular (`detalle-cel.png`) → C10-8
- Sin barra con logo: cabecera curva (radio 36) con «‹ Ofertas», puesto 22 px y empresa 13 px.
- Fila sello 78 + frase de cercanía 19 px + barra; checklist `.cardl` con checks lima; recuadro índigo «¿Usaste Tango…?» con «Sumarlo a mi CV»; botón lima fijo abajo («Postularme en el sitio del aviso»), sin pestañas.
- C9: barra con logo, «Anterior/Siguiente», badges, «¿Qué es esto?», botones «Postular / Marcar aplicada / Descartar / Cerrar», «A tu favor» en otra tarjeta, pestañas abajo.

## Qué se toca en cada ticket

| Ticket | Pantallas | Brechas |
|---|---|---|
| C10-2 | Catálogo `/settings/marca/componentes` | Tabla de primitivas de arriba |
| C10-3 | Todas las con sesión, portada y /acceso | Logo, barras, píldoras, avatar, pestañas |
| C10-4 | 1 y 2 | Portada completa |
| C10-5 | 3 y 4 | /acceso completo |
| C10-6 | 5 y 6 | Hoy completo |
| C10-7 | 7 (lista) y 8 | Ofertas |
| C10-8 | 7 (panel) y 9 | Detalle |

Lo que se saque de una pantalla para igualar la referencia (por ejemplo «Tu semana» en Hoy o los selects de Ofertas) se anota en «Decisiones para Mauro» del ticket, con dónde quedó (otra pantalla, «Más» de Perfil, o fuera).
