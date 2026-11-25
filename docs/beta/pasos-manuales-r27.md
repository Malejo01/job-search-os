# Pasos manuales de la tanda R27 (24/11)

Lo que la tanda dejó listo en el repo pero tiene que hacer una persona. Informe: [`informe-r27.md`](informe-r27.md).

## 1. Orden de integración

La R27 va encima de `ronda/r27-assets` (`main` + las imágenes de Afi). Alcanza con integrar `ronda/r27-cierre`, que trae todo. Es **carril rojo**: migración, `schema.ts`, `hoy/page.tsx`, `jobs/first-steps.tsx`, `apertura*` y la server action nueva `apps/web/lib/saludo-actions.ts` (ya está en `carril-rojo.txt` y `CODEOWNERS`; el test `carril.test.mjs` lo verifica en el CI).

## 2. Migración 0082 en Neon

| Archivo | Qué hace |
|---|---|
| `packages/db/drizzle/0082_natural_mandarin.sql` | Columna `profiles.saludo_visto` (texto `AAAA-MM-DD`, hasta 10 caracteres) |

Sin RLS nueva: es una columna de `profiles`, que ya tiene RLS, y no es de las protegidas (`rls/0026`). La app funciona sin la columna (el saludo cae al navegador), así que el orden deploy/migración no rompe nada.

Después de migrar, en una transacción de solo lectura:

```sql
BEGIN READ ONLY;
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'profiles' AND column_name = 'saludo_visto';      -- 1 fila, text
SELECT conname FROM pg_constraint WHERE conname = 'profiles_saludo_visto_shape';  -- 1 fila
SELECT count(*) FILTER (WHERE saludo_visto IS NOT NULL) FROM profiles;  -- 0
ROLLBACK;
```

## 3. Favicon con la cara (el equipo no puede copiar ni borrar archivos)

Desde la raíz del repo, en la rama de integración:

```bash
cp apps/web/public/mascota/favicon/favicon-192.png apps/web/app/icon.png
cp apps/web/public/mascota/favicon/favicon.ico apps/web/app/favicon.ico
cp apps/web/public/mascota/favicon/favicon-180.png apps/web/app/apple-icon.png
git rm apps/web/app/icon.svg apps/web/components/mascota.tsx
```

- `components/mascota.tsx` quedó vacío (`export {}`): lo reemplazó `components/afi.tsx`.
- Con los archivos en `app/`, los tests del favicon dejan de saltearse solos: `pnpm --filter @job-search-os/web exec vitest run test/mascota-afuera.test.ts` y el e2e 263.
- Opcional: `public/mascota/favicon/` queda duplicado y se puede borrar (nada lo usa; los tamaños 16, 32, 48 y 512 solo están ahí).
- La PWA (`public/icons/`, `app/manifest.ts`) no cambió.

## 4. Emails
La imagen de Afi en los emails se arma con la URL base que ya usan (`SITE_URL`/`APP_URL`). En producción tiene que ser la URL pública: si no, el cliente de correo no la carga. No hay variables nuevas.

## 5. Pruebas que quedan
- e2e que en local se saltean por el usuario del seed (corren en el CI): `85-asistente`, parte de `86-asistente-acciones`.
- `86-cv-chat-repreguntas` falló en local; la tanda no tocó esa pantalla. Mirar si falla también en el CI.
- A mano: un error de la raíz (`global-error`), el festejo en el celular (que el aviso arriba a la derecha no tape la barra) y el LCP de la portada.
- Capturas: `node .claude/bin/local.mjs e2e 265` con `ops/capturas/r27/.generar`. Para Hoy con el saludo, la persona de prueba no tiene que haber saludado ese día (`saludo_visto` en `NULL` en la base local).
