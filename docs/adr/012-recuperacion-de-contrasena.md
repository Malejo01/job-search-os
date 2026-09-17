# ADR-012: Recuperación de contraseña por email y setup inicial

## Contexto

JS-045: Mauro pidió un "olvidé mi contraseña" en el login, y de paso una forma de crear el
usuario cuando todavía no existe ninguno (hoy lo hace `pnpm db:seed` a mano con
`SEED_USER_EMAIL`/`SEED_USER_PASSWORD`). Auth.js con Credentials (ADR-010) no trae ninguna
de las dos cosas resueltas.

**Esto toca ADR-010** ("sin registro público, un solo usuario, lo crea el seed"), así que queda
explícito acá: `/setup` NO es registro público. Es un bootstrap de una sola vez — funciona
únicamente mientras la tabla `users` está vacía — que reemplaza el paso manual del seed por una
pantalla. En cuanto existe una fila, la puerta se cierra para siempre, con doble candado: la app
chequea `hasAnyUser()` antes de mostrar el formulario, y la policy RLS `users_bootstrap_insert`
lo exige también en la base (`WITH CHECK (NOT EXISTS (SELECT 1 FROM users))`), así que ni un bug
en la UI podría abrir un segundo alta.

## Decisión

- **Tabla `password_reset_tokens`** (user_id, token_hash, expires_at, used_at). El valor en
  claro del token (32 bytes random) solo existe en el link del email; en la base se guarda su
  sha256. Un token vale **1 hora** y **una sola vez** (`used_at`).
- **No se revela si un email existe**: `requestPasswordReset` siempre responde en silencio
  (o redirige al mismo "listo" en la UI), exista o no la cuenta.
- **RLS**: lectura abierta (`USING (true)`) igual que `users_read`, porque consumir el link pasa
  SIN sesión — hay que poder buscar por `token_hash` antes de saber de quién es. Escritura
  (insert/update) sigue el patrón dueño (`user_id = auth.uid()`) vía `withUser`, una vez resuelto
  el usuario. Leer una fila no sirve de nada sin el token en claro.
- **Envío saliente por Resend** (`packages/adapters/src/email/resend.ts`, REST sin SDK, mismo
  estilo que el inbound de ADR-003): reusa `RESEND_API_KEY`. Sin un dominio propio verificado en
  Resend, `from` es el sandbox `onboarding@resend.dev`, que solo entrega al email de la cuenta de
  Resend — alcanza porque hay un solo usuario. `EMAIL_FROM` queda como override para cuando haya
  dominio verificado.
- **Sin RESEND_API_KEY** (dev/test/CI) el token se crea igual pero no se manda nada, mismo criterio
  de degradación que `inbound/resend.ts` cuando falta la key.
- Rutas `/forgot-password`, `/reset-password` y `/setup` públicas en `auth.config.ts` (se usan sin sesión).
- `/login` redirige a `/setup` si `hasAnyUser()` da falso; `/setup` redirige a `/login` si da
  verdadero. Crear el usuario deja al visitante logueado directo (mismo `signIn` que el login).

## Alternativas descartadas

- Usar el SDK oficial `resend` en vez de `fetch` directo: no aporta nada para dos llamadas y suma
  una dependencia; se mantiene la consistencia con el inbound existente.
- Guardar el token en claro: si se filtra la tabla (backup, log de queries), cualquiera podría
  resetear la contraseña sin haber recibido el email.

## Consecuencias

- Falta cargar `RESEND_API_KEY` (no existe todavía ni en `.env.local` ni en Vercel) para que el
  email se mande de verdad en producción; hasta entonces el flujo funciona pero no entrega mail.
- Si en algún momento hay más de un usuario, `requestPasswordReset` y el rate limit del envío hay
  que revisarlos (hoy no hay límite de pedidos por email/IP más allá del propio costo de Resend).
