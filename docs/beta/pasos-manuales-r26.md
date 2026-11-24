# Pasos manuales de la tanda R26 (24/11)

Lo que la tanda dejó listo en el repo pero tiene que hacer una persona: migraciones en Neon, el rol de Ani y las pruebas que no se pudieron correr. Informe: [`informe-r26.md`](informe-r26.md).

## 1. Orden de integración

La R26 va encima del panel /admin (`ronda/admin-panel`, PR #561), que va encima de la R25. Alcanza con integrar `ronda/r26-cierre` después del #561. Es **carril rojo**: migraciones, RLS, `layout.tsx`, `route-access.ts` y archivos nuevos que deciden quién revisa.

## 2. Migraciones y RLS en Neon

Van en un solo `pnpm db:migrate`, después de la 0078 y la RLS 0064 del panel /admin:

| Archivo | Qué hace |
|---|---|
| `packages/db/drizzle/0079_academy_reviews.sql` | Tabla `academy_reviews` (revisiones de fichas) |
| `packages/db/drizzle/0080_text_reviews.sql` | Tabla `text_reviews` (revisiones de textos) |
| `packages/db/drizzle/0081_noisy_hellion.sql` | Columna `profiles.primer_uso_visto` (texto, hasta 20 caracteres) |
| `packages/db/rls/0065_academy_reviews.sql` | `can_review_content()` y las funciones de Academy |
| `packages/db/rls/0066_text_reviews.sql` | Funciones de los textos; usa `can_review_content()` de la 0065 |

Antes de correrlo, leé los cinco archivos. Las dos tablas no tienen acceso directo de la app (RLS forzado y `REVOKE ALL`): todo pasa por funciones `SECURITY DEFINER` con `search_path` fijo.

- Quién revisa es una fila en `app_admins` o el rol `tester` en `user_roles`.
- Cualquier sesión puede leer qué fichas están aprobadas, pero solo `(slug, huella)`.

Después de migrar, dentro de una transacción de solo lectura:

```sql
BEGIN READ ONLY;
SELECT count(*) FROM academy_reviews;   -- 0
SELECT count(*) FROM text_reviews;      -- 0
SELECT count(*) FILTER (WHERE primer_uso_visto IS NOT NULL) FROM profiles;  -- 0
SELECT proname FROM pg_proc
 WHERE proname IN ('can_review_content', 'academy_approved_list', 'academy_review_add',
                   'academy_review_latest', 'academy_review_history', 'text_review_add',
                   'text_review_latest', 'text_review_history')
 ORDER BY 1;                             -- 8 filas
ROLLBACK;
```

Si se despliega antes de migrar, la app no se rompe:
- Academy muestra lo que digan los archivos.
- Las pantallas de revisión avisan que falta la base.
- El layout vuelve a leer solo el nombre.
- La checklist cuenta cero aprobados.

## 3. Hacer tester a Ani (y a quien más revise)

1. Entrá a `/admin/personas`, buscá su email y abrí su ficha.
2. Tocá «Hacer tester». Queda en el historial de la ficha.
3. Desde ese momento ve, en Ajustes, «Recorrido para revisar», «Revisar los textos» y la revisión de Academy, y en el menú «Más», «Recorrido para revisar».

Un tester solo por `ASSISTANT_TESTER_EMAILS` ve las pantallas, pero **no puede aprobar**: la base exige el rol en `user_roles` y la pantalla lo avisa. Para que apruebe, dale el rol desde el panel.

## 4. Qué hace Ani y qué te toca a vos

- **Fichas de Academy:**
  - En `/settings/academy`, Ani elige «Aprobar» o «Pedir cambios» (con comentario).
  - Una ficha aprobada aparece en `/academy` y en su «?» sin deploy.
  - Si alguien cambia el texto de la ficha en el repo, la aprobación vieja deja de valer y la ficha vuelve a borrador hasta que la aprueben de nuevo.
- **Textos del rediseño:**
  - En `/settings/textos` (o vos en `/admin/textos`) se elige «Aprobar» o «Proponer otro».
  - **Una propuesta no cambia la app.** Aparece en `/admin/textos`, en «Propuestas de Ani», con «Copiar».
  - Para que la app cambie, la pasás vos a `apps/web/lib/textos-rediseno.ts` en un PR. Ese cambio invalida la aprobación vieja de ese texto, que se vuelve a aprobar.
- **Feedback:**
  - En `/recorrido`, «Comentar esta pantalla» abre el feedback con la pantalla ya elegida.
  - En `/admin/feedback` se ve agrupado por pantalla, con la sugerencia aparte.

## 5. Pruebas que quedaron sin correr

La corrida de e2e de la tanda se cortó porque la máquina se quedó sin memoria, y no se relanzó. Con Docker abierto y la máquina libre:

```
node .claude/bin/local.mjs e2e 230 231 232 233 234 235 236 239 240 244
node .claude/bin/local.mjs e2e 109 115 116 161 164 165 170 183 184 185 186 187
node .claude/bin/local.mjs e2e 84 110 111 112 138 140
```

`157` y `160` necesitan además `PRICING_ENABLED=1` (y el 157, `MP_LINK_LISTA` con un link inventado). Ese mismo `PRICING_ENABLED=1` hace correr el caso del banner del 241.

Capturas (`ops/capturas/r26/`):
- Las de después salen con `CAPTURAS=1 node .claude/bin/local.mjs e2e 242`.
- Las de antes, contra un worktree de `a978eb3`, con `CAPTURAS_ETAPA=antes`.
- Faltan también las de `/recorrido`, `/settings/academy` y `/admin/textos`, a 390 y 1280 px, en claro y oscuro.

Medir otra vez `/onboarding` con `node .claude/bin/local.mjs build-sin-base`. La segunda pasada de R26-06 no se midió; se espera que baje de 153 kB a unos 125–130 kB.

## 6. Sin cambios

- Sin variables de entorno nuevas. `ACADEMY_DIR` solo vale con `DB_TARGET=local` y no se pone en Vercel.
- Ningún prompt ni modelo nuevo. USD 0.
