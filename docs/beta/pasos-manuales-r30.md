# Pasos manuales de la R30

Lo que tiene que hacer el responsable del proyecto. Ningún agente toca Neon, Vercel ni mergea. Informe de la tanda: `docs/beta/informe-r30.md`.

## 1. Integrar la rama de cierre (carril rojo)

La tanda toca archivos del carril rojo, por eso el PR de cierre no lo mergea ningún agente: revisalo y mergealo en GitHub. Los archivos de carril rojo de la tanda son:

- `packages/db/schema.ts`
- `packages/db/drizzle/0086_*` y `packages/db/drizzle/meta/` (snapshot y journal)
- `packages/db/src/job-saved.integration.test.ts`
- `apps/web/app/(app)/jobs/saved-actions.ts` y `apps/web/app/(app)/jobs/discard-actions.ts` (acciones nuevas)
- `apps/web/app/(app)/jobs/[id]/actions.ts` (`humanScoreAction` valida tester o admin en el servidor)

No hay que sumar nada a `.github/carril-rojo.txt` ni a `CODEOWNERS`: las dos `*-actions.ts` ya las cubre el patrón `apps/web/app/**/*-actions.ts` y `jobs/[id]/actions.ts` el patrón `apps/web/app/**/actions.ts`. Los e2e de `apps/web/e2e/` no son carril rojo.

## 2. Migración 0086 en Neon (`jobs.saved_at`)

Es la única migración de la tanda. Agrega la marca «Guardada» (una fecha, no un estado) y un índice parcial. **No hay RLS nueva:** `jobs` ya tiene la suya y la columna nueva la hereda.

SQL (de `packages/db/drizzle/0086_kind_warpath.sql`):

```sql
ALTER TABLE "jobs" ADD COLUMN "saved_at" timestamp with time zone;
CREATE INDEX "jobs_user_saved" ON "jobs" USING btree ("user_id","saved_at" DESC NULLS LAST) WHERE "jobs"."saved_at" is not null;
```

Cómo aplicarla: con el script de migraciones del repo contra Neon, confirmando con `si` como pide el script, y solo después de revisar el SQL de arriba. Nunca `db:seed`.

Verificación de solo lectura, después de aplicar:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'jobs' AND column_name = 'saved_at';
```

Tiene que devolver una fila: `saved_at`, `timestamp with time zone`, `YES`. Opcional, para el índice:

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'jobs' AND indexname = 'jobs_user_saved';
```

Qué pasa si no se aplica: «Guardar» y la pestaña «Guardadas» fallan, porque la consulta del listado lee la columna. Aplicala antes de desplegar el código.

## 3. Cómo probar cada pantalla con la revisora

Todo a 390 px de ancho (celular) y, si da el tiempo, a 1280 px. Cuenta con ofertas evaluadas, una sin evaluar y una descartada.

| Pantalla | Ruta | Qué mirar |
|---|---|---|
| Sellos | `/jobs` y cualquier detalle | Cuatro sellos: «Afinidad alta» (7 o más), «media» (5 a 6,9), «baja» (menos de 5) y «Sin evaluar». El número lleva un decimal y coma y nunca contradice al sello (un 6,9 es «media»). La palabra va debajo del círculo |
| Tarjeta | `/jobs` | Puesto, empresa, modalidad y sello; sueldo solo si el aviso lo publica; línea «Sin confirmar: …» (hasta 2 cosas); una oferta con condición excluyente que no coincide muestra «No coincide: …» arriba y baja en la lista |
| Pestañas y chips | `/jobs` | Pestañas Por revisar, Guardadas, Ya me postulé, Descartadas y Todas; cada chip con su número; el activo con ×; contador («N ofertas con estos filtros»); «Limpiar filtros»; probar volver atrás y compartir la URL |
| Estado vacío | `/jobs` con filtros que no devuelven nada | Texto simple con la acción de limpiar filtros |
| Guardar | `/jobs` y detalle | Tocar «Guardar» marca la oferta; aparece en «Guardadas» y sigue en «Por revisar»; «Quitar de guardadas» la saca de «Guardadas» |
| Descartar | `/jobs?estado=descartada` | Al descartar aparece «Oferta descartada. [Deshacer]»; en «Descartadas» la tarjeta tiene fondo neutro, «Descartada por vos», «Volver a revisar» y «Ver oferta»; nada tachado |
| Vigencia | `/jobs` y detalle de una oferta del pool cuya fuente ya no la muestra | «Este aviso ya no figura en {fuente}»; la oferta baja en «Por revisar»; las que no vienen del pool no dicen nada |
| Detalle evaluado | `/jobs/{id}` | Orden: encabezado, «Lo importante para decidir» (siempre 7 filas; «No especificado» cuando falta), «Cómo encaja», aclaración fija, secciones plegables («Requisitos» abierta) |
| Una sola tabla | `/jobs/{id}` | «Coincide / Sin confirmar / No coincide» y los conteos de «Cómo encaja» dicen lo mismo; sin paneles aparte de bloqueadores o riesgos que contradigan |
| «Cómo calculamos la afinidad» | `/jobs/{id}` | Qué sale del aviso, qué del perfil y qué está sin confirmar |
| Detalle sin evaluar | `/jobs/{id}` | «Sin evaluar», botón «Evaluar esta oferta» y la «Estimación provisoria (sin IA)» plegada |
| Preparar mi postulación | `/jobs/{id}` | Una sola sección plegable; un solo botón «Ir a postularme en {sitio} ↗», arriba y fijo en el celular; al volver, «¿Pudiste postularte?»; nada se marca solo |
| Valoración | `/jobs/{id}` | «¿Te sirve esta evaluación?»: «Sí» solo dice «Gracias»; «No» abre cuatro motivos. «Proponer otro puntaje» solo con cuenta de tester o admin |
| Legibilidad | todas las anteriores | Nada de texto diminuto ni de grises muy claros en lo necesario para decidir; probar el zoom del navegador al 200 % |

## 4. Textos nuevos para aprobar

Están en `apps/web/lib/textos-rediseno.ts` y se aprueban desde la pantalla de textos de la app:

- `ESTADO_REQUISITO_TEXTOS` y `GLOSARIO_TEXTOS` (los tres estados y las palabras del glosario).
- `SELLOS_TEXTOS` (las palabras de los sellos y la aclaración fija) y `COMO_CALCULAMOS_TEXTOS`.
- `LISTADO_TEXTOS` (pestañas, chips, tarjeta, descartadas, vigencia, estados vacío y de carga).
- `DETALLE_TEXTOS` (condiciones, «Cómo encaja», secciones, antes de evaluar, habilidades, requisitos, preparar la postulación, estado, riesgos) y los textos de cliente de `apps/web/lib/textos-postular.ts`.

Marcados `PENDIENTE-INFORME` (el plan dice «tal cual el informe» pero el informe no se pudo leer; hay que cotejarlos):

| ID | Dónde | Qué es |
|---|---|---|
| S-01, R-05 | `COMO_CALCULAMOS_TEXTOS` y palabras del sello | Redacción de las líneas |
| R-19 | `LISTADO_TEXTOS` | Texto del estado vacío |
| R-10 a R-12 | `LISTADO_TEXTOS` | Variantes de los textos de pestañas y chips |
| S-17 | `DETALLE_TEXTOS` | Frases del veredicto de «Cómo encaja» |
| S-19 | `DETALLE_TEXTOS` | Rótulos de las 7 filas |
| S-43 | `DETALLE_TEXTOS` | Motivos del «No» de «¿Te sirve esta evaluación?» |
| S-45 | `DETALLE_TEXTOS` | Aclaración de «Proponer otro puntaje» |

## 5. Lo que no se pudo verificar

- **El informe de revisión en PDF:** no se pudo leer en la máquina del equipo (falta `pdftoppm`) y el guard no permite otros lectores. Las descripciones de `docs/beta/verificacion-informe-ani.md` salen del plan y de los prompts. Para cerrar esto: pasar el PDF a texto fuera del equipo y cotejar los IDs y los textos marcados arriba.
- **Specs 16 y 36:** ahora necesitan una cuenta de tester o admin (por «Proponer otro puntaje»). En el CI el usuario e2e figura en `ADMIN_EMAILS`; en local hace falta cargarla a mano.
- **Auditoría de legibilidad:** `apps/web/e2e/340-auditoria-legibilidad.spec.ts` se corre con `AUDITORIA=1`; las capturas y el resumen quedan en `ops/capturas/r30/legibilidad/` para la revisión de diseño. El zoom al 200 % se emula con la mitad del ancho de ventana.
- **Parser de sueldo:** probado solo con montos inventados; no está conectado a ninguna fuente real.
- **Vigencia en producción:** la regla supone que el pool se actualiza a diario; conviene mirar un par de ofertas reales del pool después de integrar.

## 6. Limpieza local y e2e pendientes

- Borrar a mano el archivo sin trackear `apps/web/app/(app)/jobs/loading.tsx` (el guard no deja `rm`). Mientras exista, el e2e 153:73 falla en local (una oferta inexistente responde 200). En la rama no está.
- Con Docker abierto: `pnpm e2e:local:prepare` (el guard no lo deja al equipo) y después `pnpm e2e:local 79 81 150` para los tres que fallaron por datos de la base local.
- Con `ADMIN_EMAILS` en el runner local: `pnpm e2e:local 16 36`.
