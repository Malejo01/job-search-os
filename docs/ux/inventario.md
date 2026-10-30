# Inventario de UI (N3-1)

Fecha: 2026-10-27 · Base: commit `e563225` (HEAD de `main`). Alcance: `apps/web/app/**/*.tsx` y `apps/web/components/**/*.tsx` sin `app/api/**` (137 archivos). Rutas relativas a `apps/web`. Los conteos salen de `rg`; lo marcado «aprox.» es una clasificación a mano sobre esos resultados.

## Resumen

| Familia | Variantes visuales hoy | Usos | Archivos |
|---|---|---|---|
| 1. Botones | 7 (primario, secundario, texto, peligro, ícono, toggle 👍/👎, de color: verde/ámbar/celeste/azul) | 103 `<button>` + 9 `SubmitButton`/`PendingSubmit`/`SaveButton` | 60 |
| 2. Links con forma de botón | primario, secundario, chip/pestaña, fila de ajustes | aprox. 30 | 24 |
| 3. Tarjetas / paneles | 6 combinaciones de radio+padding+fondo, más 7 tonos de borde | 109 contenedores con `border`+`rounded` | 52 |
| 4. Badges / chips | cuadrado (`rounded px-1.5`), píldora (`rounded-full`), score (`ring-1`), contador | aprox. 42 | 10 |
| 5. Estados vacíos | recuadro punteado (p-6 centrado / p-4), inline con link | 15 recuadros + 9 inline en /hoy y /encaje | 13 |
| 6. Avisos / banners | 6 tonos (`amber`, `red`, `emerald`, `green`, `sky`, `blue`), con y sin borde | 59 recuadros `bg-*-50` | 36 |
| 7. Tablas | 3 estilos de cabecera, 2 de padding | 6 `<table>` (+3 listas móviles en paralelo) | 5 |
| 8. Formularios | 5 estilos de campo, 3 de error | 138 controles (56 `hidden`), 78 `<label>` | 46 |
| 9. Encabezados | h1 en 5 tamaños, h2 en 5 tamaños × 2 pesos | 48 h1 · 79 h2 · 14 h3 | 62 |
| 10. Colores fuera de zinc | amber, red, emerald, green, sky, blue, violet | 310 clases | 60 |
| 11. Radios | `rounded`, `rounded-md`, `rounded-lg`, `rounded-full` | 47 · 344 · 21 · 14 | — |
| 12. Animaciones | Framer Motion (2), `animate-pulse` (1), scroll suave (1) | 4 | 3 |

Modo oscuro: 0 usos de `dark:`. Tokens de marca (`--color-brand*` en `app/globals.css`): definidos, **0 usos** de `bg-brand`/`text-brand*`.

## 1. Botones

**Primario (`bg-zinc-900 text-white`).** 62 usos de `bg-zinc-900`: aprox. 42 son botón o link primario, 11 son toggles/chips activos (`border-zinc-900 bg-zinc-900`), el resto badges, numeritos de pasos, el toast de deshacer y el overlay. Entre los aprox. 42: **26 strings de clase distintos**; `px-4` 30, `px-3` 8, `px-5` 3, `px-2` 1; `text-base` 27, `text-sm` 14, `text-xs` 1; `min-h-11`/`min-h-[44px]` solo 21; `focus-visible` solo 12; disabled `opacity-60` 6, `opacity-50` 2, `bg-zinc-500` 2 (más los que agrega `SubmitButton`). **Ningún primario tiene hover** (0 `hover:bg-zinc-800`; el único hover de botón sólido es `hover:bg-emerald-800`).
- `app/(app)/jobs/page.tsx:71` — `inline-flex min-h-11 … px-3 text-sm font-medium … focus-visible:outline-zinc-900` (Link).
- `components/profile-form.tsx:484` — `min-h-11 w-full … px-4 py-2 text-base … disabled:opacity-60 sm:w-auto`.
- `app/(auth)/login/page.tsx:82` — `mt-2 rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white` (sin min-h, sin foco).
- `app/(app)/jobs/[id]/page.tsx:486` — `px-3 py-2 text-sm` (sin min-h, sin foco).
- `app/(app)/applications/page.tsx:189` — `px-2 py-1 text-xs` (aprox. 24 px de alto).
- `app/(public)/acceso/waitlist-form.tsx:151` y `app/(app)/jobs/new/paste-form.tsx:69` — disabled `bg-zinc-500` en vez de opacidad.

**`SubmitButton`** (`app/components/submit-button.tsx:10`): `useFormStatus`, `disabled`+`aria-disabled`, cambia el texto a `pendingLabel` y **agrega** `disabled:cursor-not-allowed disabled:opacity-60` a la clase que recibe. No define estilo propio: cada uso pasa la suya. 5 usos: `app/(auth)/login/page.tsx:80`, `register/page.tsx:200`, `setup/page.tsx:112` (los tres `mt-2 … px-4 py-2 text-base`, sin min-h ni foco), `app/(app)/jobs/[id]/evaluate-now.tsx:23` (`px-3 py-2 text-sm`), `app/(app)/jobs/new/job-fields.tsx:115` (con `min-h-11`). Gemelo: `PendingSubmit` en `app/components/guarded-form.tsx:158` (mismo patrón, para `GuardedForm`; 3 usos) y un tercero, `SaveButton` en `app/(app)/settings/criteria/save-button.tsx:5` (con `DEFAULT_CLASS` propio).

**Secundario (borde).** Aprox. 40 `<button>`: `border-zinc-300` 28, `border-zinc-400` 11, `border-zinc-500` 4; fondo `bg-white` o transparente; `text-zinc-700/800/900` o heredado; `rounded-md` o `rounded`.
- `app/(app)/applications/page.tsx:13` — `FOLLOW_BUTTON`: el más completo (min-h, hover, foco).
- `components/guided-tour.tsx:30` — `BUTTON` con `aria-disabled:opacity-50`.
- `app/(app)/market/page.tsx:134` — `min-h-11 … border-zinc-400 px-4 py-2 text-sm`.
- `app/(app)/jobs/[id]/status-correction.tsx:52` — `border-zinc-400 px-3 py-1.5 text-sm`.
- `app/(app)/inbox/email-actions.tsx:4` — `small = "rounded border border-zinc-300 px-2 py-1 text-zinc-700"`.
- `app/(app)/inbox/bulk-bar.tsx:52` — `h-8 w-full rounded border px-2 text-xs` (32 px).

**Terciario / texto.** 7 botones con `underline` y sin borde: `app/(app)/layout.tsx:89` («Salir», `text-sm text-zinc-600 … hover:underline`, sin min-h), `components/feedback-button.tsx:69`, `app/terminos-actualizados/page.tsx:68` (`min-h-11`), `app/onboarding/asistente/privacy-dialog.tsx:28`, `app/(app)/jobs/[id]/form-review.tsx:247` (`text-xs`).

**Peligro (rojo).** 6, en 4 estilos: sólido `bg-red-700` (`app/(app)/settings/delete-account-form.tsx:57`, `settings/criteria/page.tsx:361`); suave `border-red-300 bg-red-50 text-red-800` (`settings/invitations/waitlist-row.tsx:78`); borde `border-red-200 text-red-700` con `rounded` (`app/(app)/inbox/delete-button.tsx:27`, `delete-domain-button.tsx:25`, `bulk-bar.tsx:184`). Ninguno tiene foco ni min-h. Además `guarded-form.tsx:133` («Reintentar», borde rojo dentro de un aviso).

**Botones de color con otro significado.** Verde «aplicar» `bg-emerald-700` (`jobs/[id]/apply-button.tsx:50`, `:79`, `jobs/[id]/page.tsx:236`, `form-review.tsx:269`); ámbar «fusionar» `bg-amber-700` (`jobs/[id]/merge-button.tsx:20`); celeste (`jobs/role-nudge.tsx:52`, `app/components/email-nudge.tsx:78`, toggles `bg-sky-700` en `plan/si-aprendes.tsx:59`); azul `bg-blue-700` (`inbox/page.tsx:109`, `onboarding/asistente/assistant.tsx:239`).

**Botón-ícono.** `app/onboarding/country-search.tsx:145` (×, `min-h-11 min-w-11`, aria-label), `app/onboarding/asistente/copy-button.tsx:34` (`min-w-11`), `settings/skills/skill-row.tsx:77` («Quitar», aria-label). Bien resueltos; no comparten clase.

**👍/👎.** Tres implementaciones: `app/(app)/jobs/card-verdict.tsx:28` (`min-h-[44px] min-w-[44px] border-2 p-2`, sin color de outline), `app/(app)/jobs/[id]/verdict.tsx:42` (`min-w-[88px] border-2 px-4` con texto), `app/(public)/demo/[perfil]/feedback.tsx:6` (`min-h-11 min-w-11 border`, **sin foco visible**). Las tres: activo `border-zinc-900 bg-zinc-900 text-white`, inactivo `border-zinc-500`/`zinc-300` + `aria-pressed`.

**Inconsistencias.**
- Táctil: 53 de 103 `<button>` sin `min-h` (ni en su constante); 25 de ellos con `py-1`/`py-1.5`/`h-8` (aprox. 26–32 px). `min-h-11` (133) y `min-h-[44px]` (4) conviven para lo mismo.
- Foco: 23 de 103 `<button>` traen `focus-visible`; el resto queda con el anillo del navegador. Color del outline: zinc-900 (54), sky-900/700 (3), red-800 (1), sin color (`card-verdict`, `verdict-reason.tsx:117`).
- Disabled: `opacity-60` (11), `opacity-50` (8), `opacity-40` (1, `jobs/job-filters.tsx:122`), `bg-zinc-500` (2), `bg-zinc-100` (1), `aria-disabled:opacity-50` (1).
- Radio: 10 botones con `rounded` (4 px) entre cientos de `rounded-md` (6 px): todo /inbox y el asistente.

## 2. Links con forma de botón

Aprox. 30 `<Link>`/`<a>` en 24 archivos. Primarios (11 `<Link>` + 1 `<a>`): `app/(app)/jobs/page.tsx:69`, `app/(app)/settings/page.tsx:105`, `app/error.tsx:20`, `app/not-found.tsx:13` (sin min-h), `app/(public)/layout.tsx:69`, `app/(auth)/register/page.tsx:83` (`<a>`). CTA públicos con constante propia: `CTA_CLASS` en `app/(public)/page.tsx:23` y `como-esta-hecho/page.tsx:69` (`px-5 text-base`), `CTA` en `precios/page.tsx:24`. Secundarios: `app/error.tsx:24`, `settings/criteria/page.tsx:363`, `settings/metricas/page.tsx:72` (`border-zinc-900`, distinto al resto), `onboarding/asistente/assistant.tsx:162`. Chips/pestañas: `jobs/page.tsx:100` («En español», `rounded-full`), `market/role-tabs.tsx:30` (`rounded-md`), `inbox/page.tsx:222` (pestaña sin borde), `settings/skills/skills-form.tsx:124` (`inline-block`, sin min-h), `(public)/mercado/career-chips.tsx:27`.
- `app/onboarding/ofertas/page.tsx:51`: link subrayado en móvil que se vuelve botón primario desde `sm:` (9 clases `sm:`).
- `app/(app)/jobs/job-list.tsx:175` («Ver oferta ↗»): `min-h-11 … text-[11px] sm:min-h-0` — en escritorio queda de aprox. 22 px.
- Links de texto: `text-sky-800` (6 literales + las constantes `LINK`/`LINK_INLINE`/`EMPTY_LINK`, 44 usos en /hoy, /encaje, /jobs), `text-sky-700` (6), `text-blue-700` (6, /inbox y asistente), o subrayado heredando el color (la mayoría de los 127 `underline`).

## 3. Tarjetas / paneles

109 contenedores con `border` + `rounded` (35 `section`, 26 `div`, 26 `li`, 19 `details`, 2 `fieldset`, 1 `aside`) en 52 archivos. Radio: `rounded-md` 90, `rounded-lg` 18. Padding: `p-3` 52, `p-4` 33, `px-3 py-3`/`py-2` el resto. Borde: `zinc-200` 80, `zinc-300` 7, `zinc-400` 3, tonos de estado 18. Solo 41 llevan `bg-white`; 49 no llevan fondo y **se ven sobre el `bg-zinc-50` del `<body>`** (`app/layout.tsx:15`), o sea que hoy hay dos fondos de tarjeta (el resto tiene tono de estado o `zinc-50`).
- `rounded-md border border-zinc-200 bg-white p-4` (19): ajustes, perfil.
- `rounded-md border border-zinc-200 p-3` (18, sin fondo): `app/(app)/market/page.tsx:183`, `plan/page.tsx:275`.
- `rounded-lg border border-zinc-200 bg-white p-3` (12): `app/(app)/jobs/job-list.tsx:60` (con `hover:border-zinc-400`), `applications/page.tsx:138`, `plan/page.tsx:215`, `inbox/page.tsx:266`, `jobs/pending-jd/page.tsx:99`.
- Constantes locales iguales con otro nombre: `CARD` en `app/(app)/hoy/page.tsx:19` y `SECTION` en `app/(app)/encaje/page.tsx:25` (`flex min-w-0 flex-col gap-2 rounded-md border border-zinc-200 px-3 py-3`).
- Con tono: `market/page.tsx:224` recibe `tone="border-red-200|emerald-200|amber-200"`; `market/career-market.tsx:105` y `role-market.tsx:46` `border-sky-200` sin significado de estado.
- `app/components/trust-box.tsx:20`: `rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3` (panel gris).
- Sombras: solo 4 (`shadow-lg` en el modal `jobs/[id]/apply-button.tsx:56`).

## 4. Badges / chips / píldoras

`lib/labels.ts` sí define color: `SCORE_CLASSES` (`:98`: alto emerald-100/900 + `ring-emerald-300`, medio amber-100/900, bajo zinc-100/700, none zinc-50/600), `LOCATION_CLASSES` (`:105`: ok emerald-50/800, riesgo amber-50/900, no red-50/800), `DEMO_BADGE_CLASSES` (`:88`, **violeta**, único uso de violet) y los estados de requisito (`:261`, emerald/red/zinc). Mapas locales: `OUTCOME_CLASSES` (`app/(app)/applications/page.tsx:25`) y `STATUS_CLASSES` (`app/(app)/plan/page.tsx:25`). `STATUS_LABELS` (estado de la oferta) **no tiene color**: siempre `bg-zinc-100 text-zinc-700`.
- Cuadrado `rounded px-1.5 py-0.5` en `text-[11px]`: `app/(app)/jobs/job-list.tsx:114–158` (estado, fuente sky-50, ubicación, bloqueador red-100, riesgo amber-50, duplicado amber-100, flags zinc-50), `jobs/[id]/page.tsx:200–214`, `jobs/[id]/form-review.tsx:230–241`.
- Píldora `rounded-full px-2 py-0.5 text-xs`: `applications/page.tsx:156`, `hoy/new-job-row.tsx:26`; `px-3 py-1`: `market/page.tsx:83` (madurez de carrera emerald/amber).
- Score: caja `ring-1` de 40/48/64 px (`hoy/new-job-row.tsx:12`, `jobs/job-list.tsx:91`, `jobs/[id]/page.tsx:170`) y `rounded px-2` en la demo (`(public)/demo/[perfil]/evaluation-card.tsx:77`). «En cola» y «estimación previa» usan `border-2 border-sky-300` / `border-dashed border-zinc-400` (`job-list.tsx:69`, `:79`).
- Contador del menú: `rounded-full bg-zinc-200 px-1.5 text-xs` (`app/(app)/main-nav.tsx:25`, `:113`). Badge sólido `bg-zinc-900`: `app/onboarding/ofertas/first-offers-list.tsx:23`.
- «En español» es un chip-filtro (sección 2), no un badge.

**Inconsistencias.** Un mismo tono con dos intensidades sin regla (riesgo `amber-50` vs duplicado `amber-100`; rechazo `red-50` vs `red-100`). Ámbar significa «score medio», «riesgo de ubicación», «en curso» (plan), «en crecimiento» (market), «carrera poco madura» y «posible duplicado». Verde significa «score alto», «entrevista», «cerrada» (plan) y «aplicar». Sky-50 es «fuente» en un lado e «info» en otro. 12 usos de `text-[10px]`/`text-[11px]`.

## 5. Estados vacíos

e2e: `e2e/80-estados-vacios.spec.ts` cubre /jobs, /hoy, /market, /plan, /encaje; `e2e/33-textos-vacios.spec.ts` cubre /onboarding/ofertas y la línea de estimación previa. Dos formas:
- **Recuadro punteado** `rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm` (15 usos, 11 archivos): `app/(app)/jobs/page.tsx:155` (`EMPTY_BOX`, con título `font-medium text-zinc-900` y 3 links), `market/data-state-notice.tsx:10`, `plan/page.tsx:185`, `applications/page.tsx:132`, `inbox/page.tsx:250`, `settings/senders/page.tsx:59`. Variante `p-4` sin centrar: `app/onboarding/ofertas/page.tsx:75` y `:87`, `plan/si-aprendes.tsx:185`.
- **Inline** dentro de la tarjeta: `app/(app)/hoy/page.tsx:138`, `:157`, `:168`, `:192`, `:234`, `:270` (`text-sm text-zinc-700` + link `LINK`); `app/(app)/encaje/page.tsx:74`, `:146`, `:166` (usa `SECTION`, o sea tarjeta con borde sólido).
- El aviso «sin skills» de /market y /plan (`market/data-state-notice.tsx:47`, testid `market-sin-niveles`) es un banner ámbar, no un vacío.

**Inconsistencias.** Color del texto: `text-zinc-500` (5), `zinc-600` (6), `zinc-700` (4) para el mismo rol. `text-zinc-500` sobre el fondo `zinc-50` da aprox. 4,6:1, al límite de AA. Solo /jobs, /onboarding/ofertas y /hoy tienen título; los demás son una frase. Los links de acción van con `underline` heredado, `text-zinc-900 underline` o `text-sky-800`.

## 6. Avisos / alertas / banners

59 recuadros con `bg-*-50` (36 archivos). Forma común `rounded-md px-3 py-2 text-sm`; 14 con borde `border-*-200` (y `p-3`). Roles en todo el alcance: `role="alert"` 36, `role="status"` 31, `role="note"` 14, `aria-live` 10.

| Tono | Usos | Texto | role |
|---|---|---|---|
| amber | 21 | `text-amber-900` | alert 5, status 3, note 2, **ninguno 11** |
| red | 19 | `text-red-800` (11) / `text-red-900` (6) | alert 17, ninguno 2 |
| emerald | 10 | `text-emerald-900` | status 5, ninguno 5 |
| sky | 7 | `text-sky-900` / `sky-950` | note 4, status 2, ninguno 1 |
| green | 1 | `text-green-900` (`settings/inbound-address.tsx:22`) | status |
| blue | 1 | `text-blue-950` (`inbox/page.tsx:86`) | region |

- `app/components/email-nudge.tsx:52` y `app/(app)/jobs/role-nudge.tsx:38`: mismo banner sky con `role="note"`, texto + link + botón «No, gracias» con borde `sky-300`. Copiado, no compartido.
- `app/components/trust-box.tsx:17`: `aside` gris con `aria-labelledby`, no es un tono de aviso.
- `app/components/guarded-form.tsx:124`: error genérico rojo con botón «Reintentar».
- Errores de una línea sin recuadro: `text-sm text-red-700` + `role="alert"` (`app/(auth)/login/page.tsx:76`, `register/page.tsx:195`, `settings/invitations/create-form.tsx:33`).
- Éxito sin recuadro: `text-emerald-700` (`(auth)/forgot-password/page.tsx:43`, `login/page.tsx:73`), `text-green-800` (`components/profile-form.tsx:476`), `text-green-700` (`jobs/[id]/verdict-reason.tsx:132`).

**Inconsistencias.** Éxito en dos hues (emerald y green), info en dos (sky y blue). Ámbar con cuatro roles distintos para avisos parecidos. Rojo con texto 700, 800 o 900.

## 7. Tablas

| Tabla | Cabecera | Celdas | Móvil | a11y |
|---|---|---|---|---|
| `app/(app)/applications/page.tsx:259` | `text-left text-zinc-600`, sin peso | `py-1 pr-3`, `text-xs` | scroll con `tabIndex=0` + `aria-label` | `th` sin `scope`, sin caption |
| `app/(app)/market/skill-rows.tsx:97` | `text-xs text-zinc-600 font-medium` | `py-1 pr-2` | lista aparte `sm:hidden` (`:58`) | `scope="col"` |
| `app/(app)/plan/si-aprendes.tsx:232` | `text-xs text-zinc-700 font-semibold` | `py-2 pr-3` | tarjetas aparte (`:295`) | caption visible, `scope` col/row |
| `app/onboarding/asistente/portal-stats.tsx:26` | `text-zinc-600 font-medium` | `py-1 pr-2` | lista aparte (`:80`) | caption `sr-only`, `scope` |
| `app/(app)/settings/metricas/page.tsx:103`, `:167` | sin thead | `py-1` | — | caption, `scope="row"` |

Separador de filas: `border-t border-zinc-100` (3) o `border-b border-zinc-100/200` (2). Listas tipo tabla con `<dl>` en grilla: `app/(app)/jobs/[id]/page.tsx:388`, `:404`, `:613`, `app/(app)/market/skill-rows.tsx:69`.

## 8. Formularios

138 `input/select/textarea` (56 `type="hidden"`), 78 `<label>`, 46 archivos. Campo de texto:
- `rounded-md border border-zinc-300 px-3 py-2 text-base` (15 literales + constantes `input` en `jobs/new/job-fields.tsx:3`, `jobs/new/paste-form.tsx:8`, `settings/criteria/page.tsx:18`).
- Con `min-h-11` y `aria-[invalid=true]:border-red-700`: `components/profile-form.tsx:26`, `app/onboarding/country-search.tsx:187`, `field` en `(public)/acceso/waitlist-form.tsx:8`.
- `px-2 py-2 text-sm`: `jobs/job-filters.tsx:43` (`select`, con `bg-white`), `market/page.tsx:26` (`INPUT_CLASS`); `px-2 py-1 text-xs`: 2 inputs. `border-zinc-500` una sola vez (`jobs/[id]/verdict-reason.tsx`).
- Foco: 2 de 138 controles declaran estilo de foco; el resto usa el del navegador.
- Label: `flex flex-col gap-1 text-sm` (35), `… text-xs text-zinc-600` (9, filtros), `flex flex-col gap-1` (8).
- Error de campo: `FieldError` `text-xs font-medium text-red-800` (`app/components/guarded-form.tsx:151`), `text-sm font-medium text-red-800` (`components/profile-form.tsx:54`), `text-sm text-red-700` (`(public)/acceso/waitlist-form.tsx:61`). `aria-invalid` en 19 lugares, `aria-describedby` en 28.

**Inconsistencias.** Altura del campo: `min-h-11` en unos, `py-2` (aprox. 42 px) en otros. Borde `zinc-300` sobre blanco da aprox. 1,5:1: no llega al 3:1 que pide WCAG 1.4.11 para el borde de un campo.

## 9. Encabezados y tipografía

- **h1** (48): `text-xl font-semibold` en las 11 pantallas principales de la app (`app/(app)/hoy/page.tsx:56`, `jobs/page.tsx:53`, `plan/page.tsx:153`, `encaje/page.tsx:73`, `market/page.tsx:63`, `applications/page.tsx:61`); `text-2xl` en las 10 de ajustes (`settings/page.tsx:48`); `text-lg leading-tight` en el detalle (`jobs/[id]/page.tsx:178`, `inbox/[id]/page.tsx:64`); `text-3xl sm:text-4xl` en las públicas.
- **h2 de sección** (79), cinco soluciones para el mismo rol: `text-base font-semibold text-zinc-900` (/hoy, /encaje con `H2`), `text-sm font-semibold text-zinc-700` (/plan, /applications), `font-semibold` sin tamaño (detalle, market), `text-lg font-medium` (ajustes), `text-base font-medium` (skills).
- Tamaños: `text-sm` 487, `text-xs` 256, `text-base` 105, `text-xl` 44, `text-lg` 22, `text-2xl` 18, más 12 `text-[10px]`/`[11px]`. Pesos: `font-medium` 225, `font-semibold` 181, `font-bold` 0.
- Gris de texto: `text-zinc-600` 225, `zinc-700` 177, `zinc-900` 79, `zinc-800` 71, `zinc-500` 10, `zinc-400` 1. **Contraste dudoso:** `text-zinc-400` sobre blanco (aprox. 2,5:1) en el estado deshabilitado de `app/(app)/jobs/[id]/review-nav.tsx:53`; `opacity-75` sobre `text-zinc-600` en `inbox/page.tsx:269` (aprox. 4:1).

## 10. Colores en uso

60 de 137 archivos usan algún color fuera de zinc (310 clases).

| Hue | Clases | Archivos | Para qué |
|---|---|---|---|
| zinc | todo lo demás | 137 | texto (600/700/800/900), bordes (200/300/400), fondos (white/50/100), primario 900 |
| red | 102 | 36 | error, bloqueador, rechazo, borrar, contador excedido (`components/char-counter.tsx:64`) |
| amber | 80 | 28 | advertencia, riesgo, score medio, «en curso», duplicado, fusionar |
| sky | 58 | 20 | links (800/700), info, fuente, «en cola», toggles del simulador, barra de progreso |
| emerald | 52 | 22 | éxito, score alto, ubicación ok, entrevista, aplicar |
| blue | 12 | 3 | solo /inbox y el asistente (confirmación de Gmail) |
| green | 6 | 5 | éxito suelto (duplica emerald) |
| violet | 2 | 1 (`lib/labels.ts:89`) | badge DEMO |
| white/black | 91 `bg-white`, 3 `bg-black/50` | — | superficies, overlays de modal |

## 11. Radios y espacios

- `rounded-md` 344 (botones, campos, avisos, tarjetas), `rounded` 47 (badges y todo /inbox), `rounded-lg` 21 (tarjetas de lista en /applications, /plan, /inbox, /jobs, pending-jd, modal, precios), `rounded-full` 14 (chips, contadores, barras, numeritos). Sin `rounded-xl/2xl/sm`.
- Gap: `gap-2` 196, `gap-1` 132, `gap-3` 110, `gap-4` 28, `gap-6` 15. Gap vertical de la pantalla: `gap-3` (/hoy, /jobs, /encaje, /inbox), `gap-4` (detalle, /plan, /market), `gap-5` (/applications), `gap-6` (/settings).
- Padding: `py-2` 181, `px-3` 172, `py-1` 99, `px-4` 69, `p-3` 56, `px-2` 46, `p-4` 43.

## 12. Animaciones

- `app/(app)/jobs/job-list.tsx:32–44`: `motion.ul layout` + `AnimatePresence` + `motion.li` (opacity y `y: ±6`, 0,18 s). **No respeta `prefers-reduced-motion`**: no hay `useReducedMotion` ni `MotionConfig`. `animate-pulse` en `:74` sin `motion-safe:`.
- `app/(app)/market/bar-grow.tsx:19`: `useReducedMotion()`; si reduce, `div` sin animar. Bien.
- `components/guided-tour.tsx:173`: scroll `smooth` salvo con reduce (cubierto por `e2e/57-guia.spec.ts:275`).
- No hay `transition-*` de CSS ni `motion-safe/motion-reduce`.

## Propuesta

### (a) Tokens (valor en claro = lo de hoy)

| Token | Clase | Valor hoy | Reemplaza |
|---|---|---|---|
| canvas | `bg-canvas` | zinc-50 | `<body>` (`app/layout.tsx:15`) |
| surface | `bg-surface` | white | 91 `bg-white` |
| surface-muted | `bg-surface-muted` | zinc-50 | trust-box, resumen de /hoy, badges `zinc-50` |
| surface-strong | `bg-surface-strong` | zinc-100 | chips neutros, hover de menú |
| border | `border-border` | zinc-200 | 111 `border-zinc-200` |
| border-strong | `border-border-strong` | zinc-300 | botones secundarios, campos (108 `zinc-300`) |
| text | `text-text` | zinc-900 | 79 |
| text-muted | `text-text-muted` | zinc-700 | 177 |
| text-subtle | `text-text-subtle` | zinc-600 | 225 (el piso: nada más claro para texto) |
| link | `text-link` | sky-800 | `LINK`, `EMPTY_LINK`; unifica sky-700 y blue-700 |
| primary | `bg-primary` | `var(--color-brand)` = zinc-900 | primarios, toggles activos |
| primary-hover | `hover:bg-primary-hover` | `var(--color-brand-hover)` = zinc-800 | nuevo: hoy ningún primario tiene hover |
| on-primary | `text-on-primary` | `var(--color-brand-contrast)` = white | |
| focus | `outline-focus` | zinc-900 | 54 `focus-visible:outline-zinc-900` |
| success / -soft / -line / -strong | | emerald-900 / emerald-50 / emerald-200 / emerald-700 | absorbe green-* |
| warning / -soft / -line / -strong | | amber-900 / amber-50 / amber-200 / amber-700 | |
| danger / -soft / -line / -strong | | red-800 / red-50 / red-200 / red-700 | |
| info / -soft / -line / -strong | | sky-900 / sky-50 / sky-200 / sky-700 | absorbe blue-* |
| *-muted (badge enfático) | `bg-warning-muted`… | tono-100 | `amber-100`, `red-100`, `emerald-100`, `sky-100` |

Radios: `--radius-badge` 0.25rem (`rounded`), `--radius-control` 0.375rem (`rounded-md`), `--radius-card` 0.375rem, `--radius-pill` 9999px. Las 18 tarjetas `rounded-lg` cambian 2 px si se unifican: decidirlo aparte, no en la migración. Tipografía: `title` = `text-xl font-semibold` (h1 de pantalla), `heading` = `text-base font-semibold` (h2), `eyebrow` = `text-sm font-semibold text-text-muted`; ajustes (`text-2xl`) y públicas quedan como están hasta decidir. Prohibir `text-[10px]/[11px]`: llevarlos a `text-xs` es un cambio visible, va en ticket propio.

`primary` es un alias de `brand`, no un color nuevo: así un cambio de marca llega a todos los botones.

**Lo que se decidió en N3-2** (ver `docs/ux/tokens.md`), distinto de esta propuesta:

- Nombres: `line` en vez de `border` (`border-line` se lee mejor que `border-border`) y `fg` en vez de `text` (`text-fg` en vez de `text-text`).
- Sin alias `primary`: el botón primario usa `brand` directo. Dos nombres para el mismo color invitan a que alguien los separe sin querer.
- Fondos: `surface-subtle` = zinc-50 (recuadro dentro de una tarjeta), `surface-muted` = zinc-100 (chips, hover), `surface-strong` = zinc-200 (contadores).
- `line-control` = zinc-400 para campos: no es lo de hoy (zinc-300, 1,5:1) a propósito; el contraste de los campos se termina de resolver en el ticket 4.
- Sin token `*-muted` para los fondos 100 de estado ni `--radius-badge` todavía: se suman si al migrar los badges hacen falta.

### (b) Componentes

- **`Button`** `{ variant: "primary" | "secondary" | "ghost" | "danger"; size: "sm" | "md"; pending?; pendingLabel?; type }` y `buttonClasses(opts)` para `<Link>` y `<a>` (Server Component, sin `"use client"`). Base: `inline-flex items-center justify-center rounded-control font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60`. `md`: `min-h-11 px-4 text-base`. `sm`: `min-h-11 px-3 text-sm sm:min-h-8` (44 px en el teléfono, compacto en escritorio, como hoy `job-list.tsx:175`). Secundario `border border-border-strong bg-surface text-text`; ghost subrayado; danger `bg-danger-strong text-on-primary`. `SubmitButton`, `PendingSubmit` y `SaveButton` pasan a ser `<Button pending>` con su hook. Reemplaza los aprox. 42 primarios, aprox. 40 secundarios, 7 de texto, 6 de peligro y aprox. 30 links con forma de botón. Los botones verdes, ámbar y azules pasan a `primary`/`secondary` o se documentan como excepción (decisión de producto: «aplicar» en verde). Aparte, `ToggleButton` (`aria-pressed`) para 👍/👎, filtros y el simulador.
- **`Card`** `{ as?: "section" | "li" | "article" | "div" | "details"; padding?: "sm" (p-3) | "md" (p-4); tone?: "neutral" | "success" | "warning" | "danger" | "info"; surface?: "surface" | "none"; interactive? }`. `surface="none"` existe para no cambiar nada al migrar las 49 tarjetas sin fondo de hoy. Reemplaza `CARD` (/hoy), `SECTION` (/encaje) y los 109 contenedores.
- **`Badge`** `{ tone: "neutral" | "success" | "warning" | "danger" | "info" | "brand"; shape?: "square" | "pill"; emphasis?: "soft" | "strong" }`. `SCORE_CLASSES`, `LOCATION_CLASSES`, `OUTCOME_CLASSES` y `STATUS_CLASSES` pasan a devolver un tono, no clases. `ScoreBadge` aparte (40/48/64 px). DEMO violeta: tono propio `demo` o se acepta el cambio a `info`.
- **`EmptyState`** `{ title?; children; action?: ReactNode; variant?: "boxed" | "inline"; "data-testid" }`. `boxed` = `border-dashed border-border-strong p-6 text-center text-sm text-text-subtle`. Reemplaza los 15 recuadros punteados y los 9 vacíos inline de /hoy y /encaje.
- **`Alert`** `{ tone: "info" | "success" | "warning" | "danger"; role?: "alert" | "status" | "note" | null; bordered?; title?; action? }`. Sin `role` por defecto según el tono (danger→alert, success→status, info/warning→note), pero **siempre explícito al migrar** para no cambiar lo que leen los lectores de pantalla ni los `getByRole`. Reemplaza los 59 recuadros `bg-*-50`, `email-nudge`, `role-nudge` y el error de `GuardedForm`.

### (c) Orden de migración

Conteos sobre los archivos de cada carpeta de ruta. «Literales» = `className="…"` escritos a mano.

| # | Pantalla | Archivos | `className` | literales | colores fuera de zinc | `<button>` | `rounded*` |
|---|---|---|---|---|---|---|---|
| 1 | /hoy (`app/(app)/hoy`) | 3 | 58 | 41 | 2 | 0 | 4 |
| 2 | /jobs (page, job-list, filtros, nudges, first-steps…) | 9 | 105 | 79 | 31 | 4 | 32 |
| 3 | detalle (`app/(app)/jobs/[id]`) | 11 | 193 | 181 | 62 | 17 | 66 |
| 4 | /plan | 2 | 91 | 88 | 23 | 3 | 13 |
| 5 | /encaje | 1 | 61 | 33 | 3 | 0 | 4 |
| 6 | /market | 9 | 153 | 142 | 14 | 2 | 26 |
| 7 | /applications | 1 | 71 | 67 | 15 | 3 | 12 |

/hoy y /encaje primero: ya tienen constantes (`CARD`, `SECTION`, `LINK`) y casi no usan color, así que validan Card, EmptyState y link con poco riesgo. El detalle es el más pesado (62 colores, 17 botones, 4 tipos de botón de color): conviene partirlo (cabecera+badges, acciones, form-review).

### (d) Riesgos

- **e2e por clase:** `e2e/50-onboarding-no-pierde.spec.ts:118` espera `toHaveClass(/text-red-700/)` en el contador (`components/char-counter.tsx:64`); con un token (`text-danger`) se rompe: actualizar el test en el mismo PR o validar por texto. `e2e/57-guia.spec.ts` (16 `toHaveCSS("outline-style", …)`) depende del outline que pone la guía inline: un estilo global de foco no tiene que pisarlo. `e2e/84-contanos.spec.ts:109` usa `locator("..")` desde un heading: envolver en `Card` cambia el padre.
- **e2e por texto, testid y rol:** 113 `getByText`, 280 `getByTestId`, 684 `getByRole`. Los componentes tienen que pasar `data-testid` y no cambiar copy ni `role`.
- **axe:** `e2e/70-axe-sesion.spec.ts` recorre 17 pantallas sin desactivar reglas, más 61, 72, 73, 76, 77, 81, 83 y 84. Bien como red, pero cualquier gris más claro que zinc-600 en texto lo hace fallar.
- **Marca:** el nombre sale de `packages/pipeline/src/brand.ts` (`BRAND.name`, que reexporta `PRODUCT_NAME` en `product.ts`) y el color de `--color-brand*` en `app/globals.css`. `primary` tiene que leer `brand`. No tocar el nombre del producto ni `docs/MARCA.md` salvo para sumar los tokens nuevos.
- **Cambios visibles escondidos:** agregar `min-h-11` a los 53 botones chicos, el foco a 80 botones, el hover del primario, `bg-surface` a las tarjetas transparentes o unificar `rounded-lg` y `text-[11px]` cambia la vista. Hacerlos en PRs propios, separados de la migración «sin cambios».
- **Equivalencias que no son 1:1:** hay 22 `text-red-700` (errores de una línea, botones de borrar y el contador del test de arriba) contra un `danger` de red-800; éxito emerald-900 contra `emerald-700` y `green-800` en auth y perfil; campos en zinc-300 contra un `line-control` más oscuro. Al migrar cada pantalla, decir en el PR cuáles de estas cambian la vista.
