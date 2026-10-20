# Monitoreo externo

> Mover a `docs/OPERACION.md` cuando se mergee el #102.

Dos monitores gratuitos (UptimeRobot o Better Stack, plan free) alcanzan para enterarse por email de que algo dejó de andar sin mirar el panel de Vercel.

## 1. Monitor de vida: `/api/health`

- URL: `https://<dominio>/api/health`
- Tipo: HTTP(s), método GET, cada **5 min**.
- Alerta: email a Mauro cuando el código no sea 200.
- `/api/health` es público y no devuelve datos: responde `200` si la base contesta con el rol de la app y `503` si no.

## 2. Monitor de operación: `/api/cron/status`

- URL: `https://<dominio>/api/cron/status`
- Tipo: HTTP(s), GET, cada **30 a 60 min** (los umbrales son de horas; no hace falta más).
- Header: `Authorization: Bearer <token>`
- Alerta: email cuando el código no sea 200.
- Responde `200` si todos los checks están ok, `503` si alguno falla o si la consulta falló, `401` sin token válido. Un monitor que solo mira el código HTTP alcanza.

### Qué token poner

Poner `CRON_SECRET` en un servicio de terceros le da a ese tercero el secret que dispara los crons (ingesta, evaluación, purgas). **Recomendado: un `STATUS_TOKEN` aparte, solo de lectura.**

- Si existe la variable `STATUS_TOKEN` en Vercel (no vacía), la ruta acepta **solo** ese token; `CRON_SECRET` deja de valer en esta ruta.
- Si no existe, acepta solo `CRON_SECRET`.
- `STATUS_TOKEN` no autoriza ningún cron: solo sirve para leer `/api/cron/status`. Generarlo largo y aleatorio (por ejemplo 32 bytes en hexa) y cargarlo como variable de entorno del proyecto (lo hace Mauro; no va al repo).
- Para rotarlo: cambiar la variable en Vercel y el header en el monitor.

### Forma de la respuesta

Solo agregados. Nunca emails, ids de usuario, títulos ni empresas.

```json
{
  "ok": false,
  "checks": [
    { "name": "pool_freshness_hours", "ok": true, "value": 2.1, "threshold": 13 },
    { "name": "queue_oldest_pending_hours", "ok": false, "value": 27.5, "threshold": 26 },
    { "name": "source_consecutive_errors:remoteok", "ok": true, "value": 0, "threshold": 3 },
    { "name": "queue_pending", "ok": true, "value": 12, "threshold": null },
    { "name": "queue_failed_24h", "ok": true, "value": 1, "threshold": null },
    { "name": "last_evaluation_at", "ok": true, "value": "2026-10-20T09:14:00.000Z", "threshold": null }
  ]
}
```

## Qué significa cada check y qué hacer

| Check | Falla cuando | Qué hacer |
|---|---|---|
| `pool_freshness_hours` | el aviso más recientemente visto del pool tiene más de 13 h (el cron corre cada 6 h) o el pool está vacío | El cron de ingesta no está corriendo o todas las fuentes fallan. Mirar las últimas ejecuciones del workflow de cron en GitHub Actions y los logs de Vercel de `/api/cron/*`. Si el cron anda pero las fuentes no, ver el check de fuentes. |
| `queue_oldest_pending_hours` | el mensaje pendiente más viejo que ya es elegible (`run_after` vencido) lleva más de 26 h | El worker de evaluación no vacía la cola: presupuesto de tiempo agotado corrida tras corrida, tope de gasto (`LLM_DAILY_CAP_USD`) o cron caído. Mirar en el log `evaluate: presupuesto agotado` y `worker frenado`. Los mensajes diferidos por el tope diario de un usuario no cuentan hasta que vence su espera. |
| `source_consecutive_errors:<fuente>` | la fuente tiene sus últimas 3 descargas seguidas en `error` | La fuente cambió, bloquea o está caída. Ver `error_code` en `public_job_fetches` (timeout, http_429, http_5xx, parse). Si es `parse`, probablemente cambió el formato: abrir un ticket; si es 429, bajar la frecuencia o pausar la fuente. |
| `queue_pending`, `queue_failed_24h`, `last_evaluation_at` | nunca (informativos) | Sirven para leer el JSON a mano. Muchos `failed` en 24 h suelen ser un problema del proveedor LLM: ver los logs de `cron evaluate`. |

Si el monitor recibe `503` con `{"ok": false, "error": "status falló"}` y no hay checks, falló la consulta a la base: mirar `/api/health` y los logs de Vercel (`cron status falló`).

## Presupuesto de tiempo del worker de evaluación

La ruta `/api/cron/evaluate` corre con `maxDuration` de 300 s y le pasa al worker un presupuesto de 240 s. Antes de tomar cada evaluación nueva, si el tiempo transcurrido más un margen (la evaluación más lenta de la corrida, o 30 s si todavía no hubo ninguna) supera el presupuesto, el worker corta. No interrumpe una evaluación en curso y lo que no procesó queda `pending`, sin gastar intentos. La respuesta del cron suma `stopped_by_budget` y `remaining` (pendientes elegibles, con `run_after` vencido, al cortar). Si `stopped_by_budget` es `true` varias corridas seguidas, la cola crece más rápido de lo que se vacía.
