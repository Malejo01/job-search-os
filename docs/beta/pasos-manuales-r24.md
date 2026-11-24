# Pasos manuales de la tanda R24

La tanda no trae migraciones, RLS ni variables nuevas, y no llama a ningún modelo.

## 1. Capturas para Ani

1. Abrí `ops/capturas/r24/indice.md`. Dice qué muestra cada captura y qué mirar.
2. Antes de pasárselas a Ani, mirá que ninguna muestre un dato real. Son de una persona de prueba con datos inventados, y el único email que aparece es ficticio.
3. Para regenerarlas, con Docker abierto: `node .claude/bin/local.mjs e2e 200`. Tiene que existir `ops/capturas/r24/.generar`, o corré el spec con `CAPTURAS=1`.

## 2. Revisión de Ani

- [`docs/beta/textos-para-ani.md`](textos-para-ani.md), sección de la R24: 9 decisiones de texto, cada una con su captura:
  - jerga interna en la calibración;
  - tuteo en una ficha;
  - «pool» y «Match»;
  - textos de Interview que viven en componentes;
  - el tono de «Armá tu CV con IA».
- Siguen pendientes los de la R23 (`docs/beta/pasos-manuales-r23.md` §2), sobre todo **aprobar fichas**: sin eso no se ve ningún «?» ni el buscador de Academy, y la galería no puede mostrar una ficha.

## 3. Propuesta: fichas de prueba para e2e

Hoy no se puede probar un «?» ni el buscador de Academy con una ficha aprobada sin aprobar una de verdad: `apps/web/lib/academy.ts` siempre lee `content/academy`. La propuesta es una variable solo para e2e (`ACADEMY_DIR`) que apunte a una carpeta de fichas de prueba. Toca código de producción, así que no se hizo: decidilo vos.

## 4. e2e que siguen dependiendo del usuario del seed

115 (sello), 116 (capturas viejas) y 38 (primeros pasos) necesitan el usuario del seed y corren en el CI. El 115 se adaptó a la animación nueva del sello (lee `data-estampado`): miralo en el primer CI.

## 5. Integración

Alcanza con `ronda/r24-cierre`, después de la R21 y la R23 (la cadena sale de `ronda/r23-cierre`).
