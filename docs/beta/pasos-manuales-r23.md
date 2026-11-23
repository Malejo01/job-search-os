# Pasos manuales de la tanda R23

La tanda no trae migraciones, RLS ni variables nuevas, y no llama a ningún modelo. Lo que queda es de revisión.

## 1. Política de privacidad: borrar una simulación

Desde la R23-02, la persona puede borrar una simulación de Interview desde `/interview`, y se borran también sus respuestas. Antes solo se borraban al borrar la cuenta.

- Revisá si la política de privacidad dice que las simulaciones solo se borran con la cuenta. Si lo dice, hay que ajustar el texto en `content/legal`. El equipo no lo toca.
- Borrar **no devuelve** la simulación del día: el tope diario sigue contando las borradas durante 24 h, y la confirmación lo dice.

## 2. Revisión de Ani

Todo lo que sigue está escrito y en borrador. No se ve o no cambia nada hasta que Ani lo apruebe:

| Qué | Dónde |
|---|---|
| Ficha nueva «Logros medibles» | `apps/web/content/academy/logros-medibles.md` |
| Recorrido de primer uso (4 pasos) | `PRIMER_USO` en `apps/web/lib/textos-rediseno.ts` |
| Títulos de los estados vacíos y del error de pantalla | `ESTADOS_TEXTOS` en el mismo archivo |
| Qué ficha abre cada «?» | `AYUDAS_ACADEMY` en el mismo archivo |
| Textos de Academy (buscador, «Te puede servir», relacionadas) | En línea, en `apps/web/app/(app)/academy/` |
| Textos de Interview (informe, progreso, borrar, skeleton) | `apps/web/app/(app)/interview/copy.ts` y `copy-cliente.ts`; los que se ven en el simulador, en `apps/web/lib/textos-interview.ts` (para no cargar todos los textos en el celular, `textos-rediseno.ts` los re-exporta) |

- **Los «?» no se ven mientras su ficha esté en borrador.** Hoy las 17 fichas lo están. Cuando Ani apruebe una, su «?» aparece en todas las pantallas que la usan.
- Lo mismo para Academy: sin fichas aprobadas, `/academy` muestra el vacío y el buscador no aparece.

## 3. e2e que no corrieron en local

La base local no tiene el usuario del seed y el guard no deja sembrarla, así que los specs que usan `login()` caen en «Crear cuenta». Quedan para el CI:

| Spec | Qué prueba |
|---|---|
| 183 | Academy: vacío, `?desde=`, buscador cuando haya fichas aprobadas |
| 184 | «?» en la oferta, el CV y Hoy |
| 185 | Estados vacíos con la marca |
| 187 | Detalle del sello y Dictar |

Los que crean su propio usuario sí corrieron en local: 180, 181, 182 y 186.

Para correrlos a mano, con la base sembrada: `pnpm e2e:local 183 184 185 187`.

## 4. Primer uso

El recorrido se guarda en el navegador (`localStorage`), porque la cuenta no tiene dónde guardar preferencias de pantalla. Quien entre desde otro navegador lo ve una vez más. Si se quiere guardar en la cuenta, hace falta una columna nueva (migración).

## 5. Integración

Alcanza con `ronda/r23-cierre`. Sale de `ronda/r21-cierre`, así que **primero va la R21**. Es carril rojo porque toca `interview/server.ts`: el PR lo mergeás vos.
