import {
  cvCoachAllowed,
  cvCoachMode,
  cvDownloadWarnings,
  profileAgentFlagFor,
  cvScreen,
  profileAgentPath,
} from "@job-search-os/pipeline";
import { HelpTip } from "@/components/help-tip";
import Link from "next/link";
import { CvItemsDiagnosis } from "@/components/cv-coach/items-diagnosis";
import { CvPreview } from "@/components/cv-preview";
import { getSessionEmail } from "@/lib/profile-agent/access";
import { CvAvisos } from "@/components/cv-avisos";
import { CvDescargas } from "@/components/cv-download-button";
import { CvOpciones } from "@/components/cv-opciones";
import { cvDraftResumePath, loadCvDraftSummary } from "@/lib/cv-draft";
import { canCreateInvitations } from "@/lib/invitations";
import {
  buildUserCv,
  cvChatMode,
  cvOptionsQuery,
  loadCvLinks,
  parseCvOptions,
} from "@/lib/cv-source";
import { requireUserId } from "@/lib/session";
import { loadKeywordMarket } from "./cv-keywords-market";
import { EstadoMarca } from "@/components/estado-marca";
import { buttonClasses, cardClasses } from "@/components/ui";
import { CV_ASISTENTE_TEXTOS, CV_CALIDAD_TEXTOS, ESTADOS_TEXTOS } from "@/lib/textos-rediseno";
import { continueHref, pendingHref } from "@/lib/cv-tu-cv";

export const metadata = { title: "CV" };
export const dynamic = "force-dynamic";

type Params = Partial<
  Record<
    "lang" | "email" | "basicas" | "lugar" | "tel" | "linkedin" | "github" | "portfolio" | "otro",
    string | string[]
  >
>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Puerta única de `/cv` (R12-6, D6 de ADR-038): con el agente de perfil activo para la persona, dos caminos
 * en vez de dos botones sueltos. «Tengo CV» lleva a la lectura (`/cv/perfil`); «No tengo CV», al chat
 * (`/cv/armar`) o, si el chat no está abierto para la persona, a cargar el historial a mano.
 */
function CvDoor({ chatVisible }: { chatVisible: boolean }) {
  const option = cardClasses({ level: "list", padding: "md", className: "flex flex-col gap-2" });
  return (
    <section
      aria-labelledby="cv-puerta"
      data-testid="cv-door"
      className="no-print flex flex-col gap-3"
    >
      <h2 id="cv-puerta" className="text-base font-bold text-fg">
        ¿Ya tenés un CV hecho?
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={option}>
          <p className="text-sm text-fg-muted">
            Lo leemos en tu navegador (el archivo no se sube), vos confirmás lo que entendimos y
            completamos solo lo que falte.
          </p>
          <Link
            href={profileAgentPath("app", "read")}
            className={buttonClasses({ className: "self-start" })}
          >
            Tengo CV
          </Link>
        </div>
        <div className={option}>
          <p className="text-sm text-fg-muted">
            {chatVisible
              ? "Te hago preguntas de a una y armamos tu CV charlando."
              : "Cargá tus trabajos y estudios a mano y armamos el CV con eso."}
          </p>
          <Link
            href={chatVisible ? "/cv/armar" : "/settings/historial"}
            className={buttonClasses({ variant: "secondary", className: "self-start" })}
          >
            No tengo CV
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * Tu CV (C-25, CVC-2): vista previa en HTML semántico del CV armado solo con lo que la persona
 * confirmó, checklist de lo que falta, descarga en DOCX y PDF por impresión del navegador. Server
 * Component; la única parte de cliente es el botón de imprimir.
 */
export default async function CvPage({ searchParams }: { searchParams: Promise<Params> }) {
  const userId = await requireUserId();
  const raw = await searchParams;
  const opts = parseCvOptions({
    lang: first(raw.lang),
    email: first(raw.email),
    basicas: first(raw.basicas),
    lugar: first(raw.lugar),
    linkedin: first(raw.linkedin),
    github: first(raw.github),
    portfolio: first(raw.portfolio),
    tel: first(raw.tel),
    otro: first(raw.otro),
  });
  const mode = cvChatMode(process.env);
  // El email de la sesión se lee una sola vez y solo si algún flag está encendido
  let emailRead: Promise<string | null> | null = null;
  const sessionEmail = () => (emailRead ??= getSessionEmail(userId));
  const coachFlagFor = async (getEmail: () => Promise<string | null>) => {
    if (cvCoachMode(process.env) === "off") return false;
    try {
      return cvCoachAllowed(process.env, await getEmail());
    } catch {
      return false;
    }
  };
  // R7-6: el CV y el permiso del chat no dependen uno del otro
  const [doc, chatVisible, agentVisible, coachVisible, keywordMarket, draft, storedLinks] =
    await Promise.all([
      buildUserCv(userId, opts),
      mode === "all"
        ? Promise.resolve(true)
        : mode === "admin"
          ? canCreateInvitations(userId).catch(() => false)
          : Promise.resolve(false),
      // ADR-034: «Subí tu CV y armamos tu perfil», detrás de CV_PROFILE_AGENT (apagado: no aparece)
      profileAgentFlagFor(process.env, sessionEmail),
      // el coach exige además el agente de perfil: mismo email, una sola consulta
      coachFlagFor(sessionEmail),
      // R20-01: mercado del puesto principal para las palabras clave (una lectura, en caché)
      loadKeywordMarket(userId),
      // R33-02: ¿hay un borrador sin confirmar? (no es un dato del CV: no cambia el estado)
      // Si la tabla todavía no existe (migración sin aplicar), la pantalla sigue sin el aviso
      loadCvDraftSummary(userId).catch(() => null),
      // R33-07: los links guardados (la vista previa solo muestra los marcados)
      loadCvLinks(userId).catch(() => ({})),
    ]);
  // R33-07/08: la misma consulta para la vista previa y las dos descargas
  const download = cvOptionsQuery(opts);
  const downloadWarnings = doc ? cvDownloadWarnings(doc) : [];
  const firstWarning = downloadWarnings[0];
  const completeHref =
    (firstWarning === "education" || firstWarning === "summary"
      ? pendingHref(firstWarning, { chatVisible })
      : null) ?? "/settings/historial";
  // R33-01: tres estados (la regla vive en el pipeline). El borrador no es un dato: solo suma el aviso.
  const screen = cvScreen(doc, { hasDraft: draft?.any === true });
  const hasEntry = agentVisible || chatVisible;
  // C-03: lo que está en el borrador del chat no «falta»: está sin confirmar, y se retoma
  const inDraft: Partial<Record<string, string>> = {
    summary: draft?.chat?.sections.includes("resumen")
      ? CV_ASISTENTE_TEXTOS.borrador.secciones.resumen
      : undefined,
    experience: draft?.chat?.sections.includes("experiencia")
      ? CV_ASISTENTE_TEXTOS.borrador.secciones.experiencia
      : undefined,
    education: draft?.chat?.sections.includes("estudios")
      ? CV_ASISTENTE_TEXTOS.borrador.secciones.estudios
      : undefined,
  };
  const missing = screen.pending.map((key) => {
    const section = inDraft[key];
    return {
      key,
      ...CV_CALIDAD_TEXTOS.tuCv.pendientes[key],
      // R11-12: el resumen no sale del perfil; sin chat no hay dónde escribirlo y se dice la verdad
      href: pendingHref(key, { chatVisible }),
      draftNote: section
        ? CV_ASISTENTE_TEXTOS.borrador.sinConfirmar.replace("{seccion}", section)
        : null,
    };
  });
  // Con la puerta a la vista (nada cargado) no se lista lo que falta: todo falta
  // Sin la puerta de dos caminos (agente de perfil apagado) la lista de lo que falta es la guía
  const showPending = screen.state === "partial" || (screen.state === "empty" && !agentVisible);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="no-print text-title font-bold text-fg">Tu CV</h1>
      <p className="no-print text-sm text-fg-muted">
        Se arma solo con lo que cargaste y confirmaste, en una columna y con títulos estándar para
        que lo lea cualquier sistema de selección. No lleva foto, fecha de nacimiento, documento ni
        dirección.
      </p>
      <HelpTip topic="cv" className="no-print" />

      {screen.showDraftNotice ? (
        <p
          data-testid="cv-borrador"
          className="no-print flex flex-wrap items-center gap-x-3 text-sm text-fg"
        >
          {CV_ASISTENTE_TEXTOS.borrador.hay}
          {draft?.chat ? (
            <Link
              href="/cv/armar"
              className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-2"
            >
              {CV_ASISTENTE_TEXTOS.borrador.retomar}
            </Link>
          ) : null}
          {draft?.coach ? (
            <Link
              href={
                cvDraftResumePath({ chat: null, coach: draft.coach, any: true }) ?? "/cv/perfil"
              }
              className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-2"
            >
              {CV_ASISTENTE_TEXTOS.borrador.coachRetomar}
            </Link>
          ) : null}
        </p>
      ) : null}

      {/* R12-6 + R33-01: sin nada cargado, la puerta con los dos caminos; con datos desaparece */}
      {screen.showDoor && agentVisible ? <CvDoor chatVisible={chatVisible} /> : null}

      {screen.state === "partial" && hasEntry ? (
        <Link
          href={continueHref(screen.pending, { chatVisible })}
          data-testid="cv-seguir"
          className={buttonClasses({ className: "no-print self-start" })}
        >
          {CV_CALIDAD_TEXTOS.tuCv.seguir}
        </Link>
      ) : null}

      {screen.showDoor && !agentVisible && chatVisible ? (
        <Link
          href="/cv/armar"
          // C9-11: secundario; la lima queda para «Descargar DOCX», la acción principal de la pantalla
          className={buttonClasses({ variant: "secondary", className: "no-print self-start" })}
        >
          Armá tu CV con IA
        </Link>
      ) : null}

      {!doc ? (
        <EstadoMarca
          tipo="cv"
          role="alert"
          data-testid="cv-sin-perfil"
          title={ESTADOS_TEXTOS.cvSinPerfil.title}
          action={
            <Link href="/settings/perfil" className={buttonClasses()}>
              {ESTADOS_TEXTOS.cvSinPerfil.action}
            </Link>
          }
        >
          {ESTADOS_TEXTOS.cvSinPerfil.text}
        </EstadoMarca>
      ) : screen.state === "empty" && agentVisible ? null /* R33-01: solo los dos caminos */ : (
        <>
          {screen.state === "complete" ? (
            <p data-testid="cv-completo" className="no-print text-sm text-fg-muted">
              <strong className="text-fg">{CV_CALIDAD_TEXTOS.tuCv.completoTitulo}.</strong>{" "}
              {CV_CALIDAD_TEXTOS.tuCv.completoTexto}
            </p>
          ) : null}
          {showPending && missing.length > 0 ? (
            <section
              aria-labelledby="cv-faltan"
              data-testid="cv-faltantes"
              className={cardClasses({
                tone: "warning",
                padding: "md",
                className: "no-print flex flex-col gap-2",
              })}
            >
              <h2 id="cv-faltan" className="text-base font-bold text-warning">
                {CV_CALIDAD_TEXTOS.tuCv.faltanTitulo}
              </h2>
              <ul className="flex flex-col gap-1 text-sm text-warning">
                {missing.map((m) => (
                  <li key={m.key}>
                    {m.draftNote ? `${m.draftNote}.` : `${m.text}.`}{" "}
                    {m.draftNote ? null : m.href ? (
                      <Link
                        href={m.href}
                        className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
                      >
                        {m.cta}
                      </Link>
                    ) : (
                      "Todavía no hay dónde escribirlo."
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <CvItemsDiagnosis
            doc={doc}
            coach={coachVisible}
            keywordMarket={keywordMarket}
            chatVisible={chatVisible}
          />

          {/* R33-09: avisos suaves (titular, habilidades sin respaldo, viñetas de tareas) */}
          <CvAvisos doc={doc} />

          {/* R33-07: opciones que actualizan la vista previa solas, y los links del CV */}
          <CvOpciones opts={opts} links={storedLinks} />

          <div className="no-print flex flex-wrap items-start gap-3">
            {/* R33-08: DOCX y PDF reales; antes de bajar avisa si el CV está incompleto (C-46) */}
            <CvDescargas query={download} warnings={downloadWarnings} completeHref={completeHref} />
            <Link href="/settings/historial" className={buttonClasses({ variant: "ghost" })}>
              Editar mi historial
            </Link>
          </div>

          <CvPreview doc={doc} />
        </>
      )}
    </div>
  );
}
