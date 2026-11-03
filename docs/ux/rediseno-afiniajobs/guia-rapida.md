# Guía rápida del diseño de AfinIAJobs

Una página para quien suma una pantalla después del rediseño C9. Las decisiones completas están en `decisiones-c9.md` (esta carpeta); los valores, en `docs/ux/tokens.md`; la voz, en `docs/MARCA.md`. El catálogo vivo de todo esto está en **`/settings/marca/componentes`** (solo admin).

## Antes de escribir una línea

1. **Una sola cosa memorable por pantalla.** Casi siempre es el sello. Si la pantalla no tiene ofertas, es el título o la ilustración.
2. **Server Component por defecto.** `"use client"` solo si hay interactividad real. Framer Motion solo en `components/motion/` (el sello que se estampa y el check que rebota).
3. **Nada de colores sueltos.** Clases semánticas (`bg-surface`, `text-fg-muted`, `border-edge`), nunca `bg-white` ni `text-zinc-700`.

## Qué primitiva usar

| Necesito | Uso | Ejemplo |
|---|---|---|
| La acción principal de la pantalla | `Button` / `buttonClasses()` (lima) | `<Link href="/jobs" className={buttonClasses()}>Ver mis ofertas</Link>` |
| Otra acción | `buttonClasses({ variant: "secondary" })`, `"ghost"` o `"dark"` | `<Button variant="secondary">Copiar</Button>` |
| Algo destructivo | `variant: "danger"` | «Borrar cuenta» |
| Un panel | `Card` (`level` `flat`, por defecto) | `<Card padding="md">…</Card>` |
| Una tarjeta de lista que se toca entera | `Card level="list" pressable` o `cardClasses({ level: "list", pressable: true })` | Accesos de Ajustes |
| La tarjeta destacada (una por pantalla) | `level="featured"` (6 px abajo) | La oferta principal de Hoy, el detalle |
| Una oferta | `OfferCard` (tarjeta K2) con `offerPlace`, `offerCardChips` y `offerMeta` de pipeline | Hoy |
| El puntaje | `Seal` (nunca un número suelto) | `<Seal score={8.5} />`, `size="detail"` en el detalle |
| Lo que tenés o te falta | `Chip tone="have"` / `"missing"` (siempre ícono y texto) | `<Chip tone="missing" srLabel="Te falta">Tango</Chip>` |
| Un filtro o pestaña que se toca | `filterChipClasses({ selected })` + `aria-pressed` o `aria-current` | Pestañas de `/inbox` |
| Una etiqueta (estado, fuente) | `Badge` | `<Badge tone="info">LinkedIn (email)</Badge>` |
| Un campo | `Field` o `inputClasses()` | `<Field label="Email" hint="…" error={…} />` |
| Un aviso | `Alert` con el `role` que corresponda (`alert`, `status`, `note` o `null`) | `<Alert tone="danger" role="alert">…</Alert>` |
| Una lista vacía | `EmptyState` con `illustration` y **una** acción | `/jobs` sin ofertas |
| Un error que corta la pantalla | `FullScreenState` | 404, `error.tsx` |
| Una ilustración | `<Illustration escena="vacio" className="w-40 sm:w-52" />` | Ver `ilustraciones.md` |

## Cuándo va la lima

**Solo** en tres lugares: el botón de acción principal (uno por pantalla o por tarjeta), el sello «Muy afín» y la pestaña o píldora activa. Nunca como fondo de un bloque, nunca como texto sobre claro, nunca para un estado. Si dudás, no va.

## Cuándo un borde de 6 px

- **6 px**: botones (`md`) y la tarjeta destacada de la pantalla.
- **4 px**: tarjetas de lista, chips y filtros, botones `sm`.
- **Sin borde inferior**: paneles que no se tocan (`Card` `flat`), badges, campos.

Todo lo que tiene borde inferior y se toca lleva `pressable`: se hunde 3 px sin mover el layout. Si el elemento tiene borde de arriba, declaralo: `[--jso-edge-top:2px]`.

```tsx
<Link
  href={`/jobs/${id}`}
  className="pressable edge-4 block rounded-card border-edge bg-surface p-4"
>
  …
</Link>
```

## Cabeceras

La cabecera índigo curva (pegada a la barra en el celular) va **solo** en Hoy y en `/acceso`. En el resto, la barra fina del layout alcanza: la pantalla empieza con su `h1`. La portada lleva un bloque índigo redondeado, no una cabecera curva.

## Cómo se escribe un texto

1. **La onda, solo en momentos tranquilos** (saludo, vacíos, logros). Con un error o un puntaje bajo: claro y sereno.
2. **Lo que falta es un paso**: «Sumá Tango y esta oferta te queda mucho más cerca», no «Te falta Tango».
3. **Un guiño local por pantalla, como mucho** («te queda pintada», «te calza», el mate).

Los botones dicen qué hacen («Guardar descripción», «Ver mis ofertas»). Se trata de «vos». **Nunca se promete trabajo.** Los textos del modelo no se reescriben.

```tsx
// Bien
<Alert tone="danger" role="alert">
  No pudimos guardar la descripción. Tu texto sigue acá: revisá la conexión y tocá Guardar otra vez.
</Alert>
// Mal: «¡Uy! Algo salió mal 😅»
```

## Movimiento

Nada entra escalonado, nada flota, nada en loop (salvo el anillo del sello en cola). El hundimiento es CSS. Con «reducir movimiento», nada se anima. Si hace falta un momento de marca nuevo, se discute antes: hoy hay dos.

## Antes de abrir el PR

- axe en claro y en oscuro (los e2e 70, 88, 113, 114 y 116 son el modelo).
- 44 px de área táctil, foco visible, sin scroll horizontal a 390 px.
- Si cambiaste un texto que un e2e busca, actualizá el e2e en el mismo PR.
