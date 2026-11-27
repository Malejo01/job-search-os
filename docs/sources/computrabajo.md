# Fuente: Computrabajo (alertas por email) · lector listo y apagado

**En una línea (R32-05):** avisos locales en español de Argentina que llegan por email, uno por tarjeta (título, empresa, ubicación y el link al aviso); el portal tiene más peso en administración, contabilidad y finanzas, ventas y atención al cliente, recursos humanos, logística y oficios, y poco en tecnología (la cobertura por carrera se confirma con las primeras alertas reales). Se prende con `POOL_COMPUTRABAJO_READER=1`.

- **Lector:** `packages/adapters/src/inbound/pool-computrabajo.ts` (ADR-043). Solo lee los emails reenviados a las casillas `pool-<carrera>@`; la app no crea alertas ni navega el portal (ADR-004): cada persona arma las suyas.
- **Falla cerrado:** estructura desconocida, recordatorio, seguimiento de una empresa, link que no es de Computrabajo, tracker sin `url=`, ID que no es de 32 hex, más de 100 tarjetas o HTML de más de 1 MB: el email entero va a la cola manual del pool, con el motivo (sin texto ni links del email). Nunca extracción parcial.
- **Privacidad:** de cada link solo queda la URL pública del aviso; los parámetros del tracker identifican a quien recibió el email y se descartan.
- **Lo que el email no dice queda `null`:** países permitidos, descripción, fecha, contrato. La carrera sale de la casilla, no del título.
- **Atribución:** «vía Computrabajo» y el link al aviso original.
- **Falta para prenderlo:** un email real reenviado, comparado con el esqueleto del log (ADR-043); lo hace el responsable.
