# Operación: comandos de administración

Tres comandos para operar la app sin depender de un cartero humano. Los tres comparten reglas:

- **Base local por defecto** (Docker). La nube solo con `--remote`, y entonces piden escribir `si` en una terminal; sin terminal abortan. Ni `--yes` ni `CONFIRM_PRODUCTION` saltean esa confirmación. La salida muestra solo `local (…)` o `remoto`, nunca el host de la nube.
- En producción **solo los corre Mauro**. Un agente no usa `--remote`.
- Nunca imprimen la URL de la base ni secretos. Los emails salen enmascarados (`l***@dominio`), salvo el link de `admin:invite`.
- Todos los datos de los ejemplos son ficticios (`@example.com`).

## `pnpm admin:invite`

```
pnpm admin:invite [--email <email>] --by <email-admin> [--remote]
```

Crea una invitación sin entrar a la app. `--by` es la cuenta que figura como creadora y tiene que estar en `ADMIN_EMAILS`. Con `--email`, solo ese email puede canjearla. Vence a los 14 días, igual que desde la página de invitaciones. Imprime el link (con `AUTH_URL` o `NEXT_PUBLIC_APP_URL`) **una sola vez**: en la base queda su sha256.

Ejemplo en local:

```
pnpm admin:invite --by admin@example.com --email nueva@example.com
```

## `pnpm admin:test-users`

```
pnpm admin:test-users --list | --reset <email> [--allowlist <ruta>] [--show-emails] [--yes] [--remote]
```

Lista y resetea **cuentas de prueba**, y solo las que figuran en la allowlist: un archivo de texto con un email por línea (`#` para comentarios). Por defecto `ops/test-users.txt` (no versionado), relativo a donde se lanzó `pnpm`. Sin allowlist, o vacía, el comando aborta.

- `--list`: por cada email de la allowlist, si existe, fecha de alta, si completó el onboarding y cuántos jobs, evaluaciones y postulaciones tiene. Los emails salen enmascarados salvo con `--show-emails`.
- `--reset <email>`: borra todos los datos de esa cuenta con el mismo borrado que «Eliminar mi cuenta». Pide escribir el email completo para confirmar (también en local) salvo con `--yes`, que solo vale en local. Nunca borra un email de `ADMIN_EMAILS`, y con `--remote` solo acepta la allowlist por defecto. **No recrea la cuenta**: el siguiente paso es `admin:invite` y registrarse de nuevo.

Ejemplo en local:

```
pnpm admin:test-users --list
pnpm admin:test-users --reset prueba@example.com
```

## `pnpm inbound:replay`

```
pnpm inbound:replay <fixture.json> --to <email-de-usuario> [--remote]
```

Reproduce un email **sintético** por el mismo camino que el webhook de Resend después de verificar la firma: guarda el crudo, deja la fila en `inbound_emails` y despacha por remitente. Sirve para probar la ingesta de punta a punta sin esperar un email real. Imprime el parser elegido, la cantidad de jobs, el destino (ingestado, cola manual, descartado o sin avisos) y el id de `inbound_emails`. Con `--remote`, `--to` tiene que ser una cuenta de la allowlist de prueba: un replay ingesta avisos y encola evaluaciones, que son llamadas pagas al LLM.

El fixture es un JSON validado con Zod: `from` y `subject` obligatorios, `text` y `headers` opcionales, y el cuerpo en `html` (en línea) o en `htmlFile` (ruta relativa al JSON, para reusar los HTML públicos de `packages/adapters/src/inbound/fixtures/**`). Hay un ejemplo en `packages/adapters/src/admin/fixtures/replay-linkedin-ejemplo.json`.

Ejemplo en local (el usuario tiene que existir y haber completado el onboarding):

```
pnpm inbound:replay packages/adapters/src/admin/fixtures/replay-linkedin-ejemplo.json --to prueba@example.com
```

Si el usuario no tiene criterios activos, el email queda en la cola manual con ese motivo: es el comportamiento normal del despacho, no un fallo del comando.

## Smoke post-deploy

Después de cada deploy exitoso a Production, `.github/workflows/smoke.yml` corre `apps/web/e2e-smoke/smoke.spec.ts` contra la URL de producción, que está fija en el workflow (nunca la del evento). Es **de solo lectura**: `/api/health`, login, `/jobs`, abrir la primera oferta si hay y `/applications`. No toca botones que escriban.

Sin secrets corre solo `/api/health` y el resto queda `skipped`. Para el recorrido con sesión, Mauro crea:

1. Una cuenta de prueba en producción, solo para esto: invitación con `admin:invite`, registro y onboarding.
2. Los secrets `E2E_PROD_EMAIL` y `E2E_PROD_PASSWORD` en GitHub (Settings → Secrets and variables → Actions). Nunca en el repo.

Si falla, el job queda en rojo y GitHub avisa. No sube trazas ni capturas: podrían mostrar datos de la cuenta de prueba.

Corrida manual, desde `apps/web`: `SMOKE_BASE_URL=<url> pnpm smoke`.
