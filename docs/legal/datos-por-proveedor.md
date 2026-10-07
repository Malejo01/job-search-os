# Inventario de datos por proveedor (borrador)

> Estado: borrador para revisión de [RESPONSABLE]. Fecha del código leído: 2026-10-07. Lo que no se pudo confirmar en el código figura como "a confirmar". Lo que dice cada proveedor sobre entrenamiento, región y retención está marcado "a revisar". No es asesoramiento legal.

## 1. Proveedores

| Proveedor | Rol | Qué recibe | Región / transferencia | Entrenamiento (a revisar) |
|---|---|---|---|---|
| Google (Gemini API) | Evaluar avisos, extraer skills, parsear email de respaldo | Prompt armado con perfil, restricciones, criterios y texto del aviso | A confirmar (Estados Unidos u otra región de Google); transferencia internacional | A revisar: los términos de la API paga indican no usar el contenido para entrenar; el nivel gratuito sí puede. Confirmar con qué plan corre la clave |
| Anthropic (Claude API) | Fallback de `evaluate_job` y `extract_skills`; principal de borradores de respuestas, mensajes y entrevista de skills | Prompt equivalente; en borradores, hechos del perfil, respuestas previas y el aviso | A confirmar (Estados Unidos); transferencia internacional | A revisar: la API comercial no entrena con el contenido por defecto |
| Resend | Email entrante (webhook + API para pedir el cuerpo) y saliente (recuperación de contraseña) | Cada email reenviado a `ingest.<dominio>` (completo); el email del usuario y el link de reseteo | A confirmar; Estados Unidos probable | A revisar: retención de emails recibidos, plazo y si se pueden borrar |
| Vercel | Hosting de la app web y logs de ejecución | Todo request a la app; logs de funciones | A confirmar (región de las funciones); Estados Unidos probable | No aplica |
| Neon | Base Postgres (todos los datos de la tabla 2) | Todo lo persistido | A confirmar (región del proyecto); backups / historial por el plazo del plan | No aplica |

## 2. Dato → dónde se guarda → proveedor → para qué → retención

| Dato | Tabla / lugar | Viaja a | Para qué | Retención conocida |
|---|---|---|---|---|
| Email de la cuenta, hash de contraseña (scrypt) | `users` (`packages/db/schema.ts`) | Neon; Resend (email solo al pedir reseteo, `apps/web/lib/password-reset.ts`) | Autenticación, recuperación | Hasta borrar la cuenta. El hash nunca sale de la base |
| Token de reseteo (hasheado sha256) | `password_reset_tokens` | Neon; el valor en claro solo va en el link por Resend | Recuperación; vence en 1 hora | Las filas usadas o vencidas no se purgan en el código leído: a confirmar |
| Nombre, titular, país, ciudad, remoto, autorización de trabajo, años, inglés CEFR, piso salarial, horas, zona horaria, resumen | `profiles` | Neon; **Google/Anthropic** (resumen, ubicación, autorización, piso, horas, inglés, años: `packages/pipeline/src/evaluation.ts`, `packages/adapters/src/worker/evaluate-job.ts`). Nombre visible y titular no entran al prompt de evaluación | Evaluar ajuste de cada aviso | Hasta borrar la cuenta |
| Dirección de ingesta personal `u_<id>@ingest.<dominio>` | `profiles.inbound_address` | Neon; Resend la ve en cada email entrante | Recibir los reenvíos | Hasta borrar la cuenta |
| Criterios de evaluación (reglas, piso mensual) | `evaluation_criteria` | Neon; **Google/Anthropic** (`renderCriteria`) | Prefiltro y prompt | Hasta borrar la cuenta; las versiones viejas se conservan |
| Hechos verificables del perfil (proyecto, afirmación, métrica, fuente) | `candidate_facts` | Neon; **Anthropic** (o Google con fallback) solo al redactar borradores (`packages/adapters/src/applicant/drafts.ts`) | Redactar respuestas de formularios | Hasta borrar la cuenta |
| Respuestas fijas (disponibilidad, contratación, autorización, links) | `application_settings` | Neon. No van al prompt: las completa el código. También las lee el MCP del usuario | Respuestas fijas en formularios | Hasta borrar la cuenta |
| Banco de respuestas aprobadas y respuestas por oferta | `answer_bank`, `application_answers` | Neon; hasta 2 respuestas previas por pregunta van al prompt de borradores | Reutilizar respuestas | Hasta borrar la cuenta |
| Email reenviado de remitente esperado (completo: evento + cuerpo) | `raw_blobs` (`packages/adapters/src/inbound/handle.ts`) | Neon; Resend lo procesa antes y retiene a su manera (a revisar) | Extraer avisos; auditoría del origen | **Sin purga en el código leído**: queda hasta borrar la cuenta. A confirmar |
| Email de remitente no esperado (filtro JS-051) | `raw_blobs` con `redacted`; `inbound_emails` | Neon | Red de seguridad si el reenvío trae correo personal | En la base solo remitente, destinatarios, asunto, fecha e id; **Resend sí recibió el email completo** y su retención es ajena al filtro |
| Metadatos del email (remitente, asunto, parser, error, fechas) | `inbound_emails` | Neon | Bandeja y cola manual | Hasta borrar la cuenta |
| Decisiones sobre dominios remitentes | `inbound_sender_domains` | Neon | Filtro de remitentes | Hasta borrar la cuenta |
| Contador de emails rechazados por límite horario | `inbound_rejections` | Neon | Aviso en la bandeja | Hasta borrar la cuenta |
| Avisos: empresa, título, ubicación, sueldo, texto de la JD, URL, fuente | `jobs`, `job_sources` | Neon; **Google/Anthropic** (título, empresa y JD en el prompt) | Evaluar y mostrar | Hasta borrar la cuenta. El catálogo `companies` no tiene dueño: **queda después del borrado** |
| Evaluaciones (score, match, gaps, veredicto, salida completa del modelo, nota humana) | `evaluations` (`raw`) | Neon | Mostrar y calibrar | Hasta borrar la cuenta |
| Postulaciones manuales (canal, sueldo pedido, nota, respuestas, resultado) | `applications` | Neon | Seguimiento. El sistema nunca envía nada (ADR-004) | Hasta borrar la cuenta |
| Contactos (nombre, rol, canal, notas): **datos de terceros** | `contacts` | Neon | Seguimiento de reclutadores | Hasta borrar la cuenta |
| Plataformas, skills del usuario, evidencia, entrevistas, plan de aprendizaje | `talent_platforms`, `skill_levels`, `skill_evidence`, `skill_interviews`, `learning_plan_items` | Neon; `skill_interviews` puede ir a Anthropic/Google (tarea `skill_interview`, a confirmar qué contenido) | Plan de skills | Hasta borrar la cuenta |
| Registro de llamadas a LLM (tarea, modelo, tokens, costo, latencia, error; **sin contenido**) | `llm_calls` | Neon | Control de costo y tope por usuario | Se borra con la cuenta; el campo `error` puede contener texto del proveedor (a confirmar). Filas sin dueño no se borran |
| Cola de trabajo (`{jobId,...}`, último error) | `job_queue` | Neon | Evaluación asíncrona | Filas sin dueño no se borran |
| Logs de la app (`user_id`, `job_id`, id de email, **remitente**, destinatarios al fallar, tokens, costo) | stdout → logs de Vercel (`packages/adapters/src/logger.ts`) | **Vercel** (plazo del plan: a revisar) | Operación y depuración | Fuera del alcance del borrado. El remitente de un email es dato de un tercero |
| Sesión (token con el id del usuario, 30 días) | Cookie de Auth.js (`apps/web/auth.config.ts`) | Navegador del usuario | Mantener la sesión | 30 días; no hay otras cookies en el código leído. Confirmar nombre y flags |

## 3. Qué entra a cada prompt

- **`evaluate_job`:** resumen del perfil, ubicación (ciudad y país), solo remoto, autorización de trabajo, piso salarial, horas máximas, inglés, años; los criterios completos; título, empresa y JD. Sin nombre, email ni CV crudo (ADR-008). Principal Google, fallback Anthropic (según `packages/db/seeds/model_routing.json`).
- **`draft_application_answers`:** hechos del perfil, ubicación, remoto y zona horaria, respuestas previas, título y JD (saneada) y las preguntas del formulario. Sueldo, disponibilidad y autorización no pasan por el modelo. Principal Anthropic, fallback Google.
- **`extract_skills`, `parse_email_fallback`, `recruiter_message`, `skill_interview`, `judge_calibration`:** registradas en `model_routing`; qué contenido recibe cada una en producción, **a confirmar** (`parse_email_fallback` podría recibir texto de un email: verificar si está en uso).
- **Contexto para formularios vía MCP:** lo lee el cliente Claude del propio usuario; ese tráfico va a Anthropic bajo la cuenta del usuario, no con la clave del sistema.

## 4. Lo que la política NO puede prometer

1. **No hay retención automática en el código:** ningún proceso purga `raw_blobs`, `inbound_emails`, `password_reset_tokens` ni logs. No se puede prometer "X días".
2. El borrado de cuenta no alcanza: filas técnicas sin dueño (`job_queue`, `llm_calls` en vuelo), catálogos (`companies`, `skills`), backups/historial de la base, logs de hosting y lo que retiene el proveedor de email.
3. El filtro de remitentes protege lo que se guarda en la base, no lo que el proveedor de email ya recibió.
4. Datos de terceros: remitentes y destinatarios en `inbound_emails` y en logs; nombres en `contacts`; cuerpos de emails de remitentes esperados en `raw_blobs`.
5. ADR-008 menciona un bucket privado, BYOK y el pasaje del CV: no hay código de eso todavía. No describirlo en la política hasta que exista.
