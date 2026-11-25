# Pasos manuales de la tanda R29 (25/11)

Lo que la tanda dejó listo en el repo pero tiene que hacer una persona. Informe: [`informe-r29.md`](informe-r29.md).

## 1. Orden de integración
Las 6 ramas van en cadena sobre `origin/ronda/r29-assets` (`main` con la R27 y la R28 + Afi v2). Alcanza con integrar `ronda/r29-cierre`, que trae todo. Las ramas intermedias pueden no compilar solas (por ejemplo, el modal de la R29-01 ya trae el botón de la R29-03).

Es **carril rojo**: migraciones 0084 y 0085, `packages/db/schema.ts`, RLS 0069 y 0070, `packages/db/src/**`, `apps/web/app/api/**`, `*-actions.ts` y tres librerías nuevas que se suman a `carril-rojo.txt` y `CODEOWNERS` en el cierre (`lib/feedback-report.ts`, `lib/feedback-files.ts`, `lib/admin-feedback-reports.ts`).

## 2. Migraciones 0084 y 0085, y RLS 0069 y 0070 en Neon
| Archivo | Qué hace |
|---|---|
| `packages/db/drizzle/0084_lucky_randall.sql` | Tablas `feedback_reports`, `feedback_items`, `feedback_attachments` y `blob_files` (`bytea`), con `user_id`, borrado en cascada con la cuenta y CHECK de largo y de estado |
| `packages/db/drizzle/0085_calm_jazinda.sql` | El CHECK `admin_events_action` suma `adjuntos_purga` y `adjuntos_purga_item` |
| `packages/db/rls/0069_feedback_reports.sql` | RLS + `FORCE` + `GRANT` en las 4 tablas; `admin_feedback_reports()` y `admin_feedback_report(uuid)` |
| `packages/db/rls/0070_feedback_reports_admin.sql` | Cambio de estado del admin, lectura de un adjunto para el admin, bytes de todos los adjuntos (tope global), `purge_resolved_attachments(...)` y `admin_feedback_deleted_attachments(uuid)`, todas SECURITY DEFINER con `search_path` fijo |

Se aplican con `pnpm db:migrate` (pide confirmación). Ninguna pantalla vieja depende de las tablas nuevas, así que el orden deploy/migración no rompe nada para la gente común; `/recorrido/informe` y `/admin/informes` fallan hasta que esté aplicada. Después, en una transacción de solo lectura:

```sql
BEGIN READ ONLY;
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relname IN ('feedback_reports','feedback_items','feedback_attachments','blob_files')
 ORDER BY 1;                                                                   -- 4 filas, true, true
SELECT proname, prosecdef FROM pg_proc
 WHERE proname IN ('admin_feedback_reports','admin_feedback_report','admin_feedback_item_set_status',
                   'admin_feedback_attachment','feedback_files_global_bytes',
                   'purge_resolved_attachments','admin_feedback_deleted_attachments')
 ORDER BY 1;                                                                   -- 7 filas, todas con prosecdef = true
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname = 'admin_events_action';                                        -- incluye adjuntos_purga y adjuntos_purga_item
SELECT count(*) FROM feedback_reports;                                         -- 0
ROLLBACK;
```

## 3. Variables en Vercel (todas opcionales)
| Variable | Por defecto | Qué hace |
|---|---|---|
| `VOICE_TESTER_DAILY_MINUTES` | 60 | Minutos de voz por día para testers y admins, por la vía del servidor (Opera, Brave, Firefox). En Chrome, Edge y Safari dicta el navegador y no hay cupo |
| `FEEDBACK_FILES_GLOBAL_MAX_MB` | 400 | Tope de todos los adjuntos juntos (Neon Free tiene 1 GB) |
| `ATTACHMENTS_PURGE_ENABLED` | apagado | `1` prende el cron de limpieza de adjuntos resueltos hace 30 días |

Y para que Ani dicte en Opera GX: `VOICE_SERVER_TRANSCRIBE=testers` (paso de la R25), si todavía no está.

## 4. Cron de limpieza (workflow)
El equipo no toca workflows. En `.github/workflows/cron.yml`, copiar el paso de `plan-notices` cambiando nombre y ruta:

```yaml
      - name: Limpieza de adjuntos de lo resuelto
        run: |
          curl --fail --silent --show-error --max-time 60 \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.SITE_URL }}/api/cron/purge-attachments"
```

Ajustar los nombres de los secretos y el `schedule` a los del paso de `plan-notices`. Con `ATTACHMENTS_PURGE_ENABLED` apagado, la ruta responde sin borrar nada.

## 5. e2e que quedaron sin correr en local
El sistema frenó por poca memoria el lote final. Con la máquina libre y Docker abierto:

```bash
node .claude/bin/local.mjs e2e 311 312 313 314 315 316 317 318 319
node .claude/bin/local.mjs e2e 320 321 322 323
node .claude/bin/local.mjs e2e 331
```

- 311 (sesión vencida) se arregló después de su única corrida; 312 a 319, 323 y 331 no corrieron nunca; 321 y 322 se arreglaron sin volver a correr.
- Lo de admin (322, 323, la parte de admin de 321 y de 331) se saltea sin `ADMIN_EMAILS` en el runner y corre en el CI (`ci.yml` la define).
- La suite unitaria completa también se frenó: `pnpm test`.
- Revisar que no hayan quedado `node.exe` sueltos de esas corridas (`next dev` en el puerto 3100, `vitest`): el guard no deja listarlos.
- Las capturas del informe (`ops/capturas/r29/informe/`) salen del 331.

## 6. Diagnóstico del 24/11 (R29-01)
La causa más probable de que no quedara ningún comentario: con la sesión vencida, el envío fallaba sin aviso y el texto se perdía al reabrir el modal. Además, el dictado se cortaba en silencio a 2.000 caracteres. Para confirmarlo, en solo lectura:
- en Neon, cuántos comentarios de `beta_feedback` hubo el 24/11, de todas las personas;
- en Vercel, los logs de funciones del 24/11: `feedback: guardado`, `feedback: tope diario`, `feedback: falló`, o respuestas 307 a `/login` sobre POST (si hay 307 en POST, fue la sesión vencida).

## 7. Prueba con Ani (navegador real y celular)
- En su navegador (Opera GX) y en el celular: abrir «¿Algo no anduvo?», ver «Agregar al informe» (tiene que ser tester en `/admin/personas`), armar 2 o 3 ítems en `/recorrido/informe` con texto largo, voz, una captura pegada con Ctrl+V, «Capturar esta pantalla» en la computadora y una foto de la galería en el celular; cerrar la pestaña, volver al otro día y seguir; enviar.
- Ver el informe en `/admin/informes`, abrir una miniatura, bajar un PDF, cambiar un estado y «Exportar para Claude».
- Probar a mano `global-error` (el runner de Playwright no lo puede importar) y los emails con Afi v2 en Gmail, Outlook y Apple Mail.

## 8. Textos para Ani
`INFORME_TEXTOS` en `apps/web/lib/textos-rediseno.ts`: lo que dice Afi en el informe («Contame todo lo que viste…» y el festejo al enviar), los avisos de tope y de documentos de más de 4 MB.

## 9. Límites que conviene saber
- **4 MB por documento.** Vercel no recibe más de 4,5 MB por pedido, así que PDF y DOCX se suben de hasta 4 MB (el tope de 10 MB del plan queda en el código para cuando haya subida en partes o Vercel Blob, ADR-047). Las imágenes no tienen problema: el navegador las comprime a menos de 1,5 MB.
- **Imágenes guardadas solo como WebP**, reescritas sin EXIF ni GPS (sin `sharp`, que sería una dependencia nueva). Un PNG o JPEG que llegue directo al servidor se rechaza; la pantalla nunca los manda.
- Hallazgos de seguridad: 0 altos, 0 medios, 5 bajos (1 arreglado en la tanda y 4 aceptados; detalle fuera del repo).

## 10. Borrar a mano (el guard no deja `rm`)
```bash
rm apps/web/e2e/306-emails-con-afi.spec.ts          # sin trackear: duplicado del 308
rm packages/pipeline/src/skills/zz-dump.test.ts     # sin trackear: temporal de la R28
```
