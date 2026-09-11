# ADR-008: Privacidad de datos de usuarios

**Status:** Accepted · **Date:** 2026-09-09

## Context
El perfil verificable procesa CV, exportación de LinkedIn, respuestas a entrevista y resultados de postulaciones: datos personales sensibles.

## Decision
- Archivos en bucket privado por `user_id`, URLs firmadas de 5 min, nunca públicas.
- Ningún dato de un usuario alimenta calibración, prompts o ejemplos para otro usuario sin consentimiento explícito y registrado.
- Borrado de cuenta en cascada, incluido storage y `llm_calls` (se conservan solo agregados anónimos de mercado).
- Los prompts reciben el mínimo necesario: perfil estructurado, no el CV crudo, salvo en el paso de extracción.
- BYOK opcional: la API key del usuario se guarda cifrada (pgsodium) y solo se usa para sus tareas.
- LinkedIn: el usuario sube su PDF exportado; nunca se scrapea su perfil.

## Consequences
- Fase 1: implementar bucket privado y cascade delete aunque haya un solo usuario.
- Fase 3: política de privacidad y términos antes de abrir a terceros.
