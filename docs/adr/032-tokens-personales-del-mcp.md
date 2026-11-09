# ADR-032: Tokens personales del MCP para las personas de prueba

**Status:** Accepted · **Date:** 2026-11-09 · Ticket MCP-1. Complementa ADR-004 (el MCP nunca postula ni navega LinkedIn) y ADR-010 (RLS como aislamiento).

## Context

- El servidor MCP propio (JS-035) se pensó para una sola persona: un token compartido (`MCP_TOKEN`) que opera sobre `MCP_USER_ID`. `lib/mcp-user.ts` guardaba el usuario resuelto en una variable de módulo.
- Ahora hay dos personas de prueba (Mauro y Ani) que quieren conectar su ChatGPT. Con el diseño anterior, la segunda persona operaría sobre la cuenta de la primera.
- ChatGPT solo acepta conectores con OAuth o «sin autenticación»: sin OAuth, la credencial tiene que viajar en la URL.

## Decision

1. **Un token por persona**, `afj_` + 32 bytes aleatorios (base64url). La base guarda solo el sha256 (`mcp_tokens`, migración 0060, RLS en `rls/0019`). Vence a los 30 días, se revoca al instante y hay hasta 3 activos por persona. Cae con la cuenta (cascade y borrado explícito).
2. **Resolución por request**: `mcp_token_user(hash)` (SECURITY DEFINER, search_path fijo) devuelve el dueño si el token no está revocado ni vencido, y en la misma sentencia lleva un tope de 60 llamadas por minuto por token. La ruta pasa el usuario a cada tool por `authInfo` (mcp-handler → `ctx.http.authInfo`). No queda ningún usuario cacheado entre requests.
3. **Solo testers**, con `MCP_USER_TOKENS=testers` y el mismo criterio que el asistente (`ADMIN_EMAILS` + `ASSISTANT_TESTER_EMAILS` con `ASSISTANT_ENABLED=testers`). Sin la variable, los tokens personales no funcionan (falla cerrado) y la pantalla `/settings/conexiones` da 404.
4. **`MCP_TOKEN` sigue igual**: se evalúa primero y con la misma función de siempre; su usuario se resuelve en cada tool como antes.
5. **El token puede ir en `?token=`** solo con `MCP_ALLOW_QUERY_TOKEN=1`, igual que el conector compartido. Las respuestas de falla son genéricas (401 «no autorizado», 429 «demasiadas llamadas») y el código no loguea el token ni la URL del request.
6. Las tools de lectura llevan `readOnlyHint: true`, así el chat pide confirmación solo en las que escriben. No se agregan tools ni cambia lo que hacen las 11.

## Consequences

- El token en la URL queda en la configuración del chat y puede aparecer en logs de acceso de Vercel. Se acota con hash en la base, 30 días de vigencia, revocación inmediata, tope por minuto y la lista de testers.
- Lo que la persona lee desde el chat (perfil, respuestas fijas, ofertas) llega al proveedor de ese chat: la pantalla lo avisa.
- Una tabla más con datos de usuario (`mcp_tokens`) en `USER_TABLES` y en los tests multiusuario.

## Alternativas

- **OAuth** (el camino correcto para abrirlo a la beta): fuera de este ticket. Antes de abrir el MCP a más personas que las de prueba, se reemplaza el token en la URL por OAuth.
- **Un `MCP_TOKEN` por persona en variables de Vercel**: obliga a redeployar para dar o quitar acceso y no se puede revocar desde la app.
