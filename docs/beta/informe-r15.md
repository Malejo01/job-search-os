# Informe de la tanda R15 «Planes, cobro y legales» (18/11, noche)

Todas las ramas salen de `origin/main` en `0ef91b9`. **Ningún PR se mergeó y ningún PR está abierto todavía:** las ramas están pusheadas y los textos de cada PR quedaron listos. Lo que traba la apertura está en el paso 1 de `docs/beta/informe-r13.md`.

## 1. Ramas, en el orden de merge sugerido

| Orden | Rama | Ticket | Carril | Antes de mergear |
|---|---|---|---|---|
| 1 | `ronda/r15-3-dominio-viejo` | R15-3 · User-Agent desde `SITE_URL` y doc de la mudanza | verde | — |
| 2 | `ronda/r15-4-privacidad-ia` | R15-4 · IA y proveedores en la política de privacidad | rojo | Decisiones legales (§3) |
| 3 | `ronda/r15-1-planes-v2` | R15-1 · página de planes detrás de `PRICING_V2` | verde | e2e 151 en el CI |
| 4 | `ronda/r15-2-plan-override` | R15-2 · precio especial para becados y testers | rojo | **Falta generar la migración 0067** (§3) |
| 5 | `ronda/r15-cierre` | Este informe y el Bloque 29 | verde | Al final |

## 2. Qué se probó y qué no

**La mezcla completa no se probó:** el guard del equipo bloquea `git merge`.

**Choques previstos al integrar:**

- `apps/web/app/(app)/settings/page.tsx`: lo tocan R15-1 y R15-2, las dos en la sección «Tu plan». **Es el choque más delicado de la tanda.** El link de pago de esa sección tiene que salir de `paymentOffer` (R15-2), y el precio por día y «No incluye» (R15-1) se muestran alrededor.
- `packages/pipeline/src/index.ts`: lo tocan R14-2, R15-1 y R15-2. Cada una agrega una línea de `export`.
- `packages/adapters/src/pool/cli.ts`: lo tocan R15-3 y R16-3, en líneas distintas.
- `docs/BACKLOG.md`: cada cierre agrega un bloque al final.

**Pruebas por rama:**

- **R15-1:** 31 tests unitarios, typecheck, eslint y prettier. El e2e 151 no se ejecutó y no hay capturas.
- **R15-2:** `pipeline` con 5343 tests y `billing` con 16. La integración de la base (249 tests) pasó **con la tabla creada a mano en un parche temporal**, que después se sacó. Sin la migración, el job `integration` de esta rama da rojo.
- **R15-3:** tests de `adapters` y typecheck.
- **R15-4:** cada frase de la política se contrastó con el código. Los tests de términos pasan.

## 3. Pasos manuales para el dueño del proyecto

1. **R15-2, generar la migración.** Desde `ronda/r15-2-plan-override`, en la carpeta principal: `pnpm db:generate`. Revisar el SQL, commitearlo y aplicarlo en Neon antes de mergear. `drizzle-kit` necesita `DATABASE_URL`, y el equipo no puede cargarla.
2. **R15-2, cargar `MP_LINK_TESTER_50`** en Vercel. Sin esa variable, un tester ve un mensaje para escribirle al equipo, nunca el precio completo.
3. **R15-4, confirmar que la cuenta de la API de Gemini es del plan pago.** La política lo afirma, y con el plan gratuito sería falso. La frase quedó marcada para revisión legal, y esa marca se ve en la página: hay que resolverla antes de publicar.
4. **R15-4, decidir cuándo publicar** y si se sube `TERMS_VERSION`, que obliga a todas las personas a aceptar de nuevo. Mientras no se suba, la página muestra la fecha vieja con el texto nuevo.
5. **R15-1, resolver los términos antes de prender los precios.** `terminos.md` dice que la beta es gratuita y deja precio y reembolsos sin definir, mientras `/precios` cobra.
6. **R15-3, revisar los paneles externos**, porque un POST a un 308 falla:
   - **Resend › Webhooks:** el endpoint de `/api/inbound` con el dominio actual.
   - **GitHub › Variables:** `APP_URL` con el dominio actual.
   - **Vercel:** qué redirige el dominio viejo, `SITE_URL` en Production, y `AUTH_URL` y `NEXT_PUBLIC_APP_URL` borradas o iguales a `SITE_URL`.
   - **Conectores MCP:** la URL guardada antes de la mudanza.
   - **Mercado Pago:** si algún link de pago tiene una URL de retorno al dominio viejo.

## 4. Qué quedó abierto

- **Chat de CV y coach:** mandan al modelo lo que la persona escribe, sin quitar datos personales. Solo la lectura del CV los redacta. La política nueva lo dice así; falta decidir si se redacta también ahí.
- **`assistant_chat.v1.md`** repite la frase vieja de que los modelos no reciben el nombre ni el email. Hay que corregirla en otra versión del prompt.
- **R15-1:** la etiqueta es «Recomendado» y no «Más elegido», porque no hay datos que respalden la segunda. No aparecen garantía ni «cancelás cuando quieras», porque los legales no los dicen.
- **R15-2:** no hay historial de quién puso cada marca, y la marca no vence sola.
- **R15-3:** el dominio viejo sigue escrito en algunos documentos anteriores, que son instrucciones operativas. Se pueden limpiar aparte.
- **R15-4:** la política describe el ruteo de modelos de `seeds/model_routing.json`. Si en producción la tabla difiere, hay que ajustar el texto.

## 5. Gasto de evals

USD 0. Ninguna rama toca `packages/prompts/**` ni `evals/**`.
