# Pasos manuales de la tanda R19 «Ofertas del pool para todas las carreras» (22/11)

Ninguno lo hace un agente. No hay migraciones ni variables obligatorias: con todo apagado, producción se comporta igual que hoy.

## 1. Prender el lector de Computrabajo (`POOL_COMPUTRABAJO_READER`)
Queda **apagado**. Prenderlo recién cuando llegue el primer email real de alertas a una casilla `pool-<carrera>@` y su estructura coincida con la que espera el lector.

1. Esperá el primer email real reenviado a una casilla `pool-*` (ver §3). Con el lector apagado, va a la cola manual como hasta ahora.
2. Bajalo como `.eml` y guardalo en `fixtures-private/` (nunca en el repo).
3. Pedile a una sesión de Claude que lo valide **en local** contra el lector (`parsePoolComputrabajoAlerts` en `packages/adapters/src/inbound/pool-computrabajo.ts`). Esa sesión no lee el email: corre un script que solo informa:
   - si dio `ok`;
   - cuántas tarjetas leyó, contra cuántos avisos ves vos en el email;
   - el esqueleto: conteos y una huella de 12 caracteres, sin texto ni links.
   Lo que pide el ADR-024 §9 es exactamente esto: validar con un email real antes de prender.
   - `ok` y tantas tarjetas como avisos → la estructura coincide.
   - `{ ok: false }` o menos tarjetas → no prendas nada. Hay que ajustar el lector en una tanda; mientras tanto, el email queda en la cola manual.
4. Si coincide, cargá en Vercel `POOL_COMPUTRABAJO_READER` = `1`, **solo en Production**. Cualquier otro valor lo deja apagado. Con el lector prendido, cada email deja en el log la línea `inbound: esqueleto del email del pool`: sirve para detectar si Computrabajo cambia el formato.
5. Desde ese momento, cada alerta nueva carga sus avisos al pool con «vía Computrabajo» y `countriesAllowed` vacío.

Para apagarlo, borrá la variable o poné cualquier otro valor. Detalle: `docs/adr/043-lector-pool-computrabajo.md`.

## 2. Reprocesar la cola del pool (`pnpm pool:reprocess`)
Los emails que llegaron antes de prender el lector siguen en la cola manual. Se pueden pasar por el lector:

1. **Siempre primero en seco:** `pnpm pool:reprocess --dry-run`. Muestra cuántos leería y cuántos fallan, sin escribir nada.
2. Si el resultado da bien: `pnpm pool:reprocess`. Por defecto procesa 20 por corrida; `--limit N` acepta de 1 a 200.
3. `--include-failed` reintenta también los emails que ya fallaron cerrado.
4. Por defecto corre contra la base local. Contra Neon hace falta `--remote`, que pide escribir `si` en la terminal (`CONFIRM_PRODUCTION` no saltea la pregunta). Con el lector apagado no escribe nada: solo funciona `--dry-run`.

Es idempotente: un email ya resuelto no se vuelve a leer, y los avisos se deduplican por su identificador.

## 3. Alertas desde el Gmail de amigos
La guía paso a paso para mandarle a cada persona está en [`docs/beta/guia-alertas-amigos.md`](guia-alertas-amigos.md). Por cada amigo:

1. En `/settings/metricas` → «Casillas del pool», columna «Gmail», descargá el filtro de **una** carrera. Es un XML con un solo filtro: `from:computrabajo.com` → `pool-<carrera>@<INGEST_DOMAIN>`. Si falta `INGEST_DOMAIN`, la descarga da error y no genera ningún archivo.
2. Pasale el XML y la dirección `pool-<carrera>@…`. Es **un archivo por persona**: Computrabajo manda todas las alertas desde el mismo remitente, así que con dos filtros cada email se reenviaría a las dos casillas.
3. Cuando Gmail le pida verificar la dirección de reenvío, el código llega a la casilla: leelo en Resend → Receiving y pasáselo.
4. Para darse de baja, borra el filtro y la dirección de reenvío en su Gmail. Ningún agente crea alertas, filtros ni cuentas.

## 4. Jooble y Careerjet (siguen apagadas)
- **Jooble** (ADR-039): está cableada y apagada. Para prenderla faltan:
  - registrarse y cargar `JOOBLE_API_KEY`;
  - agregar `jooble` a `POOL_SOURCES`;
  - que la pantalla diga «vía Jooble»: la fuente usa `source_kind = other`, que todavía no tiene atribución, y es un cambio chico de código;
  - un `--dry-run` con la clave real.
- **Careerjet** (ADR-039, ampliación R16-1): está **bloqueada**.
  - Hay que confirmar con Careerjet, por escrito, que se puede usar desde un servidor sin visitante.
  - Después hacen falta `CAREERJET_AFFID`, `CAREERJET_CALLER_IP` y `SITE_URL`, «vía Careerjet» en pantalla y un `--dry-run` real.
  - No se prende a la vez que Jooble, porque comparten `source_kind`.

## 5. Archivo suelto para borrar
`packages/adapters/src/inbound/computrabajo.ts.tail` es un archivo de una línea que un teammate creó por error y que no está commiteado. El guard no deja borrarlo a los agentes. Borralo a mano:
```powershell
Remove-Item packages/adapters/src/inbound/computrabajo.ts.tail
```

## 6. Verificación que queda para el CI o para vos
- **e2e 149** (cobertura del pool): no corre en local porque la base local no tiene el usuario del seed. Lo corre el CI.
- **e2e 123** (asistente): corrió en local, 9 de 9.
- **Capturas a 390 px** de Hoy, Interview, Academy y una oferta (R19-06), y de `/settings/metricas` y `/settings/salud`: no se hicieron. Lo que hay que mirar está en `docs/beta/informe-r19.md`.
