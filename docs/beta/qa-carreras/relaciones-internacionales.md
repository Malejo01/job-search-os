# QA relaciones internacionales y comercio exterior

Persona: Inés Ficticia (`ines`). Capturas: `ines-<pantalla>-390|1280.png`.

- /acceso: el chip guarda `relaciones_internacionales`. ok.
- Registro, paso 1, «Tus skills», «Tus primeras ofertas». ok.
- /hoy, /jobs y detalle con puntaje. Funciona, con un hallazgo.
- Perfil, CV y ayuda. ok.
- Prefiltro sobre el golden sintético: verde.

## Hallazgo
- **P1 · /hoy y detalle:** el requisito se llama «Puesto de ai engineer» y «Tenés (de tu perfil)» lista disciplinas técnicas (ai engineer, ml engineer, fullstack, frontend, backend, devops...) para una persona de Relaciones internacionales (`ines-hoy-390`, `ines-detalle-390`). Qué debería pasar: el requisito de puesto se compara con su carrera. La persona sí carga su carrera (`apps/web/e2e/personas/flow.ts:217`); los criterios de un usuario nuevo copian las disciplinas por defecto sin mirarla (`packages/pipeline/src/onboarding.ts:115-124`, `apps/web/lib/onboarding.ts:346-355`) y `packages/pipeline/src/decide.ts:199-205` las usa para el bloqueador de disciplina. El texto «ai engineer» puede ser del evaluador demo; confirmar con modelo real o en el CI. Detalle en el README.
