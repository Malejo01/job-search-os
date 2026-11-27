# Fuente: Jooble (API para editores) · adaptador listo y apagado

**En una línea (R32-05):** agregador de avisos de muchos portales; trae título, empresa, ubicación, un fragmento de texto (no la descripción), tipo de contrato, sueldo en texto libre y el link al portal de origen, casi todo en español para Argentina; sirve a las carreras no tech (administración, finanzas y contabilidad, comercial y atención, recursos humanos, logística), y las tech solo marginalmente. Se prende con `JOOBLE_API_KEY` y `jooble` en `POOL_SOURCES`.

- **Adaptador:** `packages/adapters/src/pool/jooble.ts` (ADR-039). Sin clave no hace ninguna llamada. Falla cerrado: una página con forma inesperada se descarta entera. La oferta entra sin descripción (`jdText` null): la persona pega el texto completo del aviso original.
- **Tope de pedidos:** 15 consultas por corrida, una cada 5 horas como mínimo (75 por día en el peor caso) y tope duro de 100 por día en el cliente. Un HTTP de error corta la corrida; la URL (lleva la clave) nunca se loguea.
- **Atribución:** «vía Jooble» en el detalle del aviso (`attributionFor("other", { sourceName: "Jooble" })`) y el link al aviso original. Solo con sesión iniciada: nada de Jooble en vitrina, `/ofertas`, `/mercado`, demo ni SEO.
- **Comparte `source_kind = other` con Careerjet:** no se prenden las dos a la vez.
- **Prueba manual:** `pnpm pool:fetch jooble --dry-run` con `JOOBLE_API_KEY` (hace 2 consultas del tope diario; imprime solo conteos y qué campos trae la respuesta real).
- Todo el formato de la API y sus condiciones están **a verificar al registrarse**: nada se probó contra la API real.
