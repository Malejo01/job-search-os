# Pasos manuales de la tanda R17

## R17-02 · Prompt del asistente v1.1

- El prompt nuevo es `packages/prompts/assistant_chat.v1.1.md` y la ruta `api/assistant` lo usa al desplegar.
- `model_routing` se resuelve por tarea (`assistant_chat`), no por versión del prompt: **la fila existente sirve y no hace falta SQL ni cambio en el seed**.
- Lo único que se ve en producción es la fecha: el asistente dice «la beta abre a principios de diciembre» (y, si la fecha de hoy ya la pasó, que la beta ya abrió).
- Para volver atrás: apuntar `PROMPT_REF` de `apps/web/app/api/assistant/route.ts` otra vez a `assistant_chat@v1`.
