# Fuente: Workable (bolsas de empresas) · NO integrada

Ficha de la ronda 103 (informe de fuentes en español, 2026-10-21). **Todavía no hay adapter.** No se integra sin el OK de Mauro y sin leer los términos. No es asesoramiento legal.

## Qué ofrece
Workable es un ATS con muchas empresas medianas que contratan remoto, algunas en LatAm y España. Como Teamtailor y los ATS de ADR-018, se usa con una **lista curada de empresas**.

## Cómo se integraría: endpoint público por cuenta
- `https://www.workable.com/api/accounts/<subdominio>` lista los avisos publicados de una cuenta. Así lo describe su ayuda oficial, pero el texto que se leyó estaba resumido. **A verificar** la forma de la respuesta y si trae la descripción completa.
- La API v3 de Workable necesita un token del cliente (la empresa), así que **no sirve** para esto.
- Encaja como un proveedor más de `ats_boards`: proveedor `workable` y la cuenta como token. Hace falta ampliar el check `ats_boards_provider_check` con una migración. Las defensas son las de ADR-018.

## Términos
Los términos no tienen una cláusula específica sobre scraping. Prohíben usar IA que compita con Workable. **Antes de integrar hay que leerlos completos** y confirmar que listar y mostrar avisos públicos con atribución no entra en esa prohibición.

## Recomendación
Integrar con prioridad baja, vía `ats_boards`, después de revisar los términos.
