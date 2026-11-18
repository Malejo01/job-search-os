# ADR-041: Intentos de login por email, en una tabla sin `user_id`

**Status:** Accepted · **Date:** 2026-11-18 · Excepción acotada a la regla de `user_id` de [ADR-002](./002-multitenant-desde-fase-1.md).

## Context
- El login tiene que contar intentos por email y pedir una espera creciente después de varios sin éxito.
- El intento llega sin sesión y puede nombrar un email que no tiene cuenta. Si solo se contaran los emails registrados, la respuesta diría cuáles existen.
- La regla general es que toda tabla con datos de usuario lleva `user_id` y RLS en la misma migración.

## Decision
1. **Tabla `login_attempts` sin `user_id`**: la clave es el sha256 del email normalizado, exista o no la cuenta. No guarda el email en claro.
2. **Sin acceso directo de la app**: RLS con `FORCE` y sin policies para los roles de la app. Solo se usa por `login_attempt_begin` y `login_attempt_clear`, funciones `SECURITY DEFINER` con el mismo patrón que `mcp_token_user`.
3. **Espera creciente, no bloqueo definitivo**: cinco intentos libres, después 1, 2, 4 y 8 minutos, con un máximo de 15. Un login correcto limpia el contador, y una hora sin intentos lo reinicia.
4. **El intento se reserva antes de verificar la contraseña**, así los pedidos en paralelo no pasan el límite.
5. **Durante la espera no se verifica la contraseña**, y la respuesta es la misma y tarda parecido a la de una contraseña incorrecta.

## Consequences
- La tabla no entra en el borrado de cuenta porque no se puede asociar a una persona. Las filas sin actividad durante un día se purgan solas.
- Alguien que conozca un email puede hacer esperar a esa persona, como máximo 15 minutos por vez. Es el costo de limitar por cuenta, y por eso no hay bloqueo definitivo.
- La migración tiene que estar aplicada antes del deploy: sin la tabla, el login falla.
