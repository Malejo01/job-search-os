import { JOB_STATUSES, type JobEvent, type JobStatus } from "@job-search-os/pipeline";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { applyJobEvent, getJobDetail, MANUAL_EVENTS } from "@/lib/job-detail";
import { listJobs } from "@/lib/jobs";
import { getMarket } from "@/lib/market";
import { mcpTokenOk, resolveMcpUserId } from "@/lib/mcp-user";
import { ingestManualJob, parseModality } from "@/lib/ingest-manual";
import { evaluateInBackground } from "@/lib/evaluate-now";
import { attachJd, listPendingJd } from "@/lib/pending-jd";
import { answersFromBank, approveAnswer, candidateProfile, saveFormAnswers } from "@/lib/applicant";
import { ANSWER_LANGS } from "@job-search-os/adapters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// paste_jd y add_job evalúan al instante en `after` dentro de esta invocación (JS-027)
export const maxDuration = 120;

/**
 * Servidor MCP propio (JS-035): la cola y las ofertas desde el chat de Claude, sin abrir la UI.
 * Streamable HTTP en /api/mcp, token compartido (lib/mcp-user.ts). Reutiliza las mismas
 * funciones que la UI (withUser + RLS; jobs.status solo vía transition()). El MCP nunca
 * postula ni navega LinkedIn (ADR-004): solo lee, cambia estados y recibe JD pegadas.
 * JS-053: contexto para responder formularios. Claude redacta en el chat; el servidor no llama
 * a ningún modelo, y las respuestas fijas (sueldo, disponibilidad, links) las da el código.
 */
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const failed = (e: unknown) => ({
  content: [
    { type: "text" as const, text: `no se pudo: ${e instanceof Error ? e.message : String(e)}` },
  ],
  isError: true,
});

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_pending_jd",
      {
        title: "Ofertas pendientes de JD",
        description:
          "Ofertas que pasaron el prefiltro pero llegaron sin descripción (máximo 10). Devuelve id, título, empresa y link al aviso para leerlo y pegar la JD con paste_jd.",
        inputSchema: z.object({}),
      },
      async () => {
        const userId = await resolveMcpUserId();
        return text(await listPendingJd(userId));
      },
    );

    server.registerTool(
      "list_jobs",
      {
        title: "Listar ofertas",
        description:
          "Ofertas ordenadas por score y fecha. Filtros: score mínimo, estado (nueva, prefiltrada, pendiente_jd, evaluada, aplicada, descartada, entrevista, oferta, cerrada… o 'todas'; default: activas) y cantidad.",
        inputSchema: z.object({
          score_min: z.number().min(0).max(10).optional(),
          status: z.enum([...JOB_STATUSES, "todas"]).optional(),
          limit: z.number().int().min(1).max(50).default(15),
        }),
      },
      async ({ score_min, status, limit }) => {
        const userId = await resolveMcpUserId();
        const rows = await listJobs(userId, {
          scoreMin: score_min ?? null,
          source: null,
          // Default "activas" explícito: en la UI `null` pasó a ser "sin revisar" (JS-061), pero la
          // tool MCP conserva su contrato documentado (fuera de alcance de ese ticket).
          status: (status as JobStatus | "todas" | undefined) ?? "activas",
          since: null,
          periodo: null,
          duplicates: false,
        });
        return text(
          rows.slice(0, limit).map((r) => ({
            id: r.id,
            score: r.score,
            title: r.title,
            company: r.company,
            status: r.status,
            location_ok: r.locationOk,
            accion: r.accion,
            bloqueadores: r.bloqueadores,
            riesgos: r.riesgos,
            demo: r.model === "fake",
            pre_score_sin_llm: r.preScore,
            first_seen: r.firstSeenAt.slice(0, 10),
          })),
        );
      },
    );

    server.registerTool(
      "get_job",
      {
        title: "Detalle de una oferta",
        description:
          "Evaluación completa (match, gaps, bloqueadores, riesgos, veredicto), fuentes con link, estado actual y eventos válidos para set_status. Incluye la JD si está.",
        inputSchema: z.object({ id: z.string().uuid() }),
      },
      async ({ id }) => {
        const userId = await resolveMcpUserId();
        const job = await getJobDetail(userId, id);
        if (!job) return { content: [{ type: "text", text: "oferta inexistente" }], isError: true };
        return text({ ...job, jdText: job.jdText ? job.jdText.slice(0, 6000) : null });
      },
    );

    server.registerTool(
      "set_status",
      {
        title: "Cambiar estado",
        description:
          "Dispara un evento de la máquina de estados (transition): apply (marcar aplicada; el sistema NUNCA postula por vos), interview, offer, reject, auto_reject, discard, close. Usá get_job para ver cuáles valen desde el estado actual.",
        inputSchema: z.object({
          id: z.string().uuid(),
          event: z.enum(MANUAL_EVENTS as readonly [JobEvent, ...JobEvent[]]),
        }),
      },
      async ({ id, event }) => {
        const userId = await resolveMcpUserId();
        try {
          const status = await applyJobEvent(userId, id, event);
          return text({ id, event, status });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { content: [{ type: "text", text: `no se pudo: ${msg}` }], isError: true };
        }
      },
    );

    server.registerTool(
      "paste_jd",
      {
        title: "Pegar descripción del puesto",
        description:
          "Guarda la JD completa de una oferta pendiente (mínimo 200 caracteres) y la evalúa al instante (en segundos aparece con score en la app; si el tope diario de LLM está superado, queda para el cron).",
        inputSchema: z.object({ id: z.string().uuid(), text: z.string().min(200) }),
      },
      async ({ id, text: jd }) => {
        const userId = await resolveMcpUserId();
        try {
          await attachJd(userId, id, jd);
          evaluateInBackground(userId, id);
          return text({ id, saved: true, chars: jd.trim().length, next: "evaluando ahora" });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { content: [{ type: "text", text: `no se pudo: ${msg}` }], isError: true };
        }
      },
    );

    server.registerTool(
      "add_job",
      {
        title: "Cargar una oferta a mano",
        description:
          "Ingesta manual (JS-023): una oferta vista en LinkedIn, un mail o un chat. Pasa por dedup (14 días), prefiltro y, si trae la descripción completa, se encola para evaluar; sin descripción queda en pendientes de JD. Devuelve el id y si se insertó o se fusionó con una existente.",
        inputSchema: z.object({
          title: z.string().min(3),
          company: z.string().min(1),
          url: z.string().url().optional(),
          location: z.string().optional(),
          modality: z
            .enum(["remoto", "hibrido", "presencial", "desconocida"])
            .default("desconocida"),
          jd_text: z.string().min(200).optional(),
          salary_min_usd: z.number().int().min(0).optional(),
          salary_max_usd: z.number().int().min(0).optional(),
          candidates: z.number().int().min(0).optional(),
        }),
      },
      async (a) => {
        const userId = await resolveMcpUserId();
        try {
          const out = await ingestManualJob(userId, {
            url: a.url ?? null,
            title: a.title,
            company: a.company,
            locationRaw: a.location ?? null,
            modality: parseModality(a.modality),
            jdText: a.jd_text ?? null,
            salaryMinUsd: a.salary_min_usd ?? null,
            salaryMaxUsd: a.salary_max_usd ?? null,
            candidatesCount: a.candidates ?? null,
          });
          // Con JD completo se evalúa ya; si no quedó nada encolado, no hace nada
          if (a.jd_text) evaluateInBackground(userId, out.jobId);
          return text(out);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { content: [{ type: "text", text: `no se pudo: ${msg}` }], isError: true };
        }
      },
    );

    server.registerTool(
      "market_summary",
      {
        title: "Resumen de mercado",
        description:
          "Gaps (demanda alta y nivel bajo), diferenciales (nivel fuerte con demanda) y skills en crecimiento del último snapshot de mercado.",
        inputSchema: z.object({ top: z.number().int().min(1).max(30).default(8) }),
      },
      async ({ top }) => {
        const userId = await resolveMcpUserId();
        const view = await getMarket(userId, { from: null, to: null });
        const pick = (rows: typeof view.agenda.gaps) =>
          rows.slice(0, top).map((r) => ({
            skill: view.skills[r.slug]?.name ?? r.slug,
            level: r.level,
            mentions: r.mentions,
            must: r.mustMentions,
            demand: r.weightedDemand,
          }));
        return text({
          week: view.weekStart,
          gaps: pick(view.agenda.gaps),
          differentials: pick(view.agenda.differentials),
          growing: pick(view.agenda.growing),
        });
      },
    );

    server.registerTool(
      "get_candidate_profile",
      {
        title: "Perfil para responder un formulario",
        description:
          "Todo lo necesario para responder un formulario de postulación: perfil (resumen, años, inglés, ubicación), hechos verificables (proyecto, afirmación, métrica, fuente, verificable | autodeclarado) y respuestas fijas (disponibilidad, contratación, derecho a trabajar, links). Reglas: no afirmes nada que no esté en `facts` ni en `profile`; lo `autodeclarado` no se presenta como verificado; las respuestas fijas y el sueldo se copian textuales, no se redactan. Con job_id, `salary` es el monto a pedir para esa oferta (kind 'pedir'); si kind es part_time, no_normalizable, bajo_piso o piso_inconsistente NO hay número: avisale a la persona y no inventes uno. Si `facts` trae la marca 'sin_hechos_cargados', `fixed_answers` trae 'sin_respuestas_fijas_cargadas' o un campo dice 'SIN CARGAR', ese dato no existe: no lo completes vos, preguntáselo a la persona.",
        inputSchema: z.object({ job_id: z.string().uuid().optional() }),
      },
      async ({ job_id }) => {
        const userId = await resolveMcpUserId();
        try {
          return text(await candidateProfile(userId, job_id ?? null));
        } catch (e) {
          return failed(e);
        }
      },
    );

    server.registerTool(
      "list_answers",
      {
        title: "Banco de respuestas aprobadas",
        description:
          "Respuestas que la persona ya aprobó en formularios anteriores. Con query, las que comparten palabras con la pregunta (más coincidencias primero); sin query, las más recientes. Cada una trae source_job_id (oferta donde se aprobó) y fechas. Reutilizá una solo si la pregunta es la misma; si hay que adaptarla, es una respuesta nueva que la persona tiene que aprobar.",
        inputSchema: z.object({
          query: z.string().optional(),
          lang: z.enum(ANSWER_LANGS).optional(),
          limit: z.number().int().min(1).max(50).default(20),
        }),
      },
      async ({ query, lang, limit }) => {
        const userId = await resolveMcpUserId();
        return text(await answersFromBank(userId, { query, lang, limit }));
      },
    );

    server.registerTool(
      "save_answer",
      {
        title: "Guardar una respuesta aprobada",
        description:
          "Guarda en el banco una respuesta que la persona aprobó EXPLÍCITAMENTE en el chat. No la llames con borradores ni con respuestas que no te confirmó. Si ya había una para la misma pregunta (normalizada) en el mismo idioma, la reemplaza. job_id: la oferta donde se aprobó, si hay una.",
        inputSchema: z.object({
          question: z.string().min(3),
          answer: z.string().min(1),
          lang: z.enum(ANSWER_LANGS),
          job_id: z.string().uuid().optional(),
        }),
      },
      async ({ question, answer, lang, job_id }) => {
        const userId = await resolveMcpUserId();
        try {
          return text(
            await approveAnswer(userId, { question, answer, lang, jobId: job_id ?? null }),
          );
        } catch (e) {
          return failed(e);
        }
      },
    );

    server.registerTool(
      "save_application_answers",
      {
        title: "Guardar el formulario de una oferta",
        description:
          "Guarda las preguntas y respuestas finales del formulario de una oferta, en orden, tal como la persona las va a enviar. Reemplaza entero lo guardado antes para esa oferta. NO postula ni marca la oferta como aplicada: para eso está set_status con apply, después de que la persona envíe el formulario por su cuenta (ADR-004).",
        inputSchema: z.object({
          job_id: z.string().uuid(),
          qa: z
            .array(z.object({ question: z.string().min(1), answer: z.string().min(1) }))
            .min(1)
            .max(60),
        }),
      },
      async ({ job_id, qa }) => {
        const userId = await resolveMcpUserId();
        try {
          return text(await saveFormAnswers(userId, job_id, qa));
        } catch (e) {
          return failed(e);
        }
      },
    );
  },
  { serverInfo: { name: "job-search-os", version: "0.2.0" } },
);

async function guarded(req: Request): Promise<Response> {
  if (!mcpTokenOk(req)) {
    return new Response(JSON.stringify({ error: "no autorizado" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return handler(req);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
