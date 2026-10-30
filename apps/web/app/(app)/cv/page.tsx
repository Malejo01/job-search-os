import type { CvMissing } from "@job-search-os/pipeline";
import Link from "next/link";
import { CvPreview } from "@/components/cv-preview";
import { PrintButton } from "@/components/print-button";
import { canCreateInvitations } from "@/lib/invitations";
import { buildUserCv, cvChatMode, parseCvOptions } from "@/lib/cv-source";
import { requireUserId } from "@/lib/session";

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

const BUTTON =
  "inline-flex min-h-11 items-center rounded-control px-4 py-2 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

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
  const doc = await buildUserCv(userId, opts);
  const mode = cvChatMode(process.env);
  const chatVisible =
    mode === "all" || (mode === "admin" && (await canCreateInvitations(userId).catch(() => false)));
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
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="no-print text-2xl font-semibold text-fg">Tu CV</h1>
      <p className="no-print text-sm text-fg-muted">
        Se arma solo con lo que cargaste y confirmaste, en una columna y con títulos estándar para
        que lo lea cualquier sistema de selección. No lleva foto, fecha de nacimiento, documento ni
        dirección.
      </p>

      {chatVisible ? (
        <Link
          href="/cv/armar"
          className={`no-print self-start bg-brand text-brand-contrast hover:bg-brand-hover ${BUTTON}`}
        >
          Armá tu CV con IA
        </Link>
      ) : null}

      {!doc ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          Completá tu perfil para armar el CV.
        </p>
      ) : (
        <>
          {missing.length > 0 ? (
            <section
              aria-labelledby="cv-faltan"
              data-testid="cv-faltantes"
              className="no-print flex flex-col gap-2 rounded-card border border-warning-line bg-warning-soft p-4"
            >
              <h2 id="cv-faltan" className="text-base font-medium text-warning">
                Para un CV completo te falta
              </h2>
              <ul className="flex flex-col gap-1 text-sm text-warning">
                {missing.map((m) => (
                  <li key={m.key}>
                    {m.text}.{" "}
                    <Link href={m.href} className="underline">
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
            className="no-print flex flex-wrap items-end gap-x-6 gap-y-3 rounded-card border border-line bg-surface p-4"
          >
            <label className="flex flex-col gap-1 text-sm font-medium text-fg">
              Idioma
              <select
                name="lang"
                defaultValue={opts.lang}
                className="min-h-11 rounded-control border border-line-control bg-surface px-2 text-base text-fg focus-visible:outline-focus"
              >
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
            <button
              type="submit"
              className={`border border-line-strong text-fg hover:bg-surface-muted ${BUTTON}`}
            >
              Actualizar vista previa
            </button>
          </form>

          <div className="no-print flex flex-wrap gap-3">
            <a
              href={`/api/cv/docx?${download}`}
              download
              className={`bg-brand text-brand-contrast hover:bg-brand-hover ${BUTTON}`}
            >
              Descargar DOCX
            </a>
            <PrintButton label="Guardar como PDF" />
            <Link href="/settings/historial" className={`text-fg underline ${BUTTON}`}>
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
