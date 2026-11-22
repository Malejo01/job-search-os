import {
  cvCoachAllowed,
  cvCoachMode,
  profileAgentFlagFor,
  profileAgentPath,
  type CvMissing,
} from "@job-search-os/pipeline";
import { HelpTip } from "@/components/help-tip";
import Link from "next/link";
import { CvItemsDiagnosis } from "@/components/cv-coach/items-diagnosis";
import { CvPreview } from "@/components/cv-preview";
import { getSessionEmail } from "@/lib/profile-agent/access";
import { PrintButton } from "@/components/print-button";
import { canCreateInvitations } from "@/lib/invitations";
import { buildUserCv, cvChatMode, parseCvOptions } from "@/lib/cv-source";
import { requireUserId } from "@/lib/session";
import { Alert, buttonClasses, cardClasses, inputClasses } from "@/components/ui";

export const metadata = { title: "CV" };
export const dynamic = "force-dynamic";

type Params = { lang?: string | string[]; email?: string | string[]; basicas?: string | string[] };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Qué le falta al CV y dónde se carga. «links» no se lista: todavía no hay pantalla para cargarlos. */
const MISSING: Partial<Record<CvMissing, { text: string; href: string; cta: string }>> = {
  experience: {
    text: "tu experiencia laboral",
    href: "/settings/historial",
    cta: "Cargá tu historial",
  },
  education: { text: "tus estudios", href: "/settings/historial", cta: "Cargá tu historial" },
  skills: { text: "tus skills", href: "/settings/skills", cta: "Marcá tus skills" },
  languages: {
    text: "tu nivel de inglés",
    href: "/settings/perfil",
    cta: "Completalo en Tu perfil",
  },
};

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
  const [doc, chatVisible, agentVisible, coachVisible] = await Promise.all([
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
  ]);
  const download = new URLSearchParams({
    lang: opts.lang,
    email: opts.includeEmail ? "1" : "0",
    basicas: opts.includeBasics ? "1" : "0",
  }).toString();
  const missing = (doc?.missing ?? []).flatMap((m) => {
    // R11-12: el resumen del CV no sale del perfil (está escrito para la IA). Hoy no hay dónde
    // escribirlo a mano: se invita a armarlo con el chat, y sin chat se dice la verdad.
    const item: { text: string; href: string | null; cta: string } | undefined =
      m === "summary"
        ? chatVisible
          ? {
              text: "un resumen",
              href: "/cv/armar",
              // R12-6: con la puerta, el botón del chat se llama «No tengo CV»
              cta: agentVisible ? "Armalo charlando con la IA" : "Armalo con «Armá tu CV con IA»",
            }
          : { text: "un resumen (todavía no hay dónde escribirlo)", href: null, cta: "" }
        : MISSING[m];
    return item ? [{ key: m, ...item }] : [];
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="no-print text-title font-bold text-fg">Tu CV</h1>
      <p className="no-print text-sm text-fg-muted">
        Se arma solo con lo que cargaste y confirmaste, en una columna y con títulos estándar para
        que lo lea cualquier sistema de selección. No lleva foto, fecha de nacimiento, documento ni
        dirección.
      </p>
      <HelpTip topic="cv" className="no-print" />

      {/* R12-6: con el agente de perfil, la puerta reemplaza a la tarjeta de subida y al link del chat */}
      {agentVisible ? <CvDoor chatVisible={chatVisible} /> : null}

      {!agentVisible && chatVisible ? (
        <Link
          href="/cv/armar"
          // C9-11: secundario; la lima queda para «Descargar DOCX», la acción principal de la pantalla
          className={buttonClasses({ variant: "secondary", className: "no-print self-start" })}
        >
          Armá tu CV con IA
        </Link>
      ) : null}

      {!doc ? (
        <Alert tone="danger" role="alert">
          Completá tu perfil para armar el CV.
        </Alert>
      ) : (
        <>
          {missing.length > 0 ? (
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
                Para un CV completo te falta
              </h2>
              <ul className="flex flex-col gap-1 text-sm text-warning">
                {missing.map((m) => (
                  <li key={m.key}>
                    {m.text}.{" "}
                    {m.href ? (
                      <Link href={m.href} className="font-semibold underline underline-offset-2">
                        {m.cta}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <CvItemsDiagnosis doc={doc} coach={coachVisible} />

          <form
            method="get"
            aria-label="Opciones del CV"
            className={cardClasses({
              padding: "md",
              className: "no-print flex flex-wrap items-end gap-x-6 gap-y-3",
            })}
          >
            <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
              Idioma
              <select name="lang" defaultValue={opts.lang} className={inputClasses()}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
              <input type="checkbox" name="email" value="1" defaultChecked={opts.includeEmail} />
              Incluir mi email
            </label>
            <input type="hidden" name="email" value="0" />
            <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
              <input type="checkbox" name="basicas" value="1" defaultChecked={opts.includeBasics} />
              Incluir skills básicas
            </label>
            <button type="submit" className={buttonClasses({ variant: "secondary" })}>
              Actualizar vista previa
            </button>
          </form>

          <div className="no-print flex flex-wrap items-center gap-3">
            <a href={`/api/cv/docx?${download}`} download className={buttonClasses()}>
              Descargar DOCX
            </a>
            <PrintButton label="Guardar como PDF" />
            <Link href="/settings/historial" className={buttonClasses({ variant: "ghost" })}>
              Editar mi historial
            </Link>
          </div>

          <CvPreview doc={doc} />
          <p className="no-print text-xs text-fg-subtle">
            Al guardar como PDF, elegí «Guardar como PDF» como destino y desactivá los encabezados y
            pies de página del navegador.
          </p>
        </>
      )}
    </div>
  );
}
