import type { CvMissing } from "@job-search-os/pipeline";
import { HelpTip } from "@/components/help-tip";
import Link from "next/link";
import { CvPreview } from "@/components/cv-preview";
import { UploadCard } from "@/components/profile-agent/upload-card";
import { profileAgentAllowedFor } from "@/lib/profile-agent/read-server";
import { PrintButton } from "@/components/print-button";
import { canCreateInvitations } from "@/lib/invitations";
import { buildUserCv, cvChatMode, parseCvOptions } from "@/lib/cv-source";
import { requireUserId } from "@/lib/session";
import { Alert, buttonClasses, cardClasses, inputClasses } from "@/components/ui";

export const metadata = { title: "Tu CV" };
export const dynamic = "force-dynamic";

type Params = { lang?: string | string[]; email?: string | string[]; basicas?: string | string[] };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Qué le falta al CV y dónde se carga. «links» no se lista: todavía no hay pantalla para cargarlos. */
const MISSING: Partial<Record<CvMissing, { text: string; href: string; cta: string }>> = {
  summary: { text: "un resumen", href: "/settings/perfil", cta: "Escribilo en Tu perfil" },
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
  // R7-6: el CV y el permiso del chat no dependen uno del otro
  const [doc, chatVisible, agentVisible] = await Promise.all([
    buildUserCv(userId, opts),
    mode === "all"
      ? Promise.resolve(true)
      : mode === "admin"
        ? canCreateInvitations(userId).catch(() => false)
        : Promise.resolve(false),
    // ADR-034: «Subí tu CV y armamos tu perfil», detrás de CV_PROFILE_AGENT (apagado: no aparece)
    profileAgentAllowedFor(userId),
  ]);
  const download = new URLSearchParams({
    lang: opts.lang,
    email: opts.includeEmail ? "1" : "0",
    basicas: opts.includeBasics ? "1" : "0",
  }).toString();
  const missing = (doc?.missing ?? []).flatMap((m) => {
    const item = MISSING[m];
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

      {agentVisible ? <UploadCard base="app" /> : null}

      {chatVisible ? (
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
                    <Link href={m.href} className="font-semibold underline underline-offset-2">
                      {m.cta}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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
