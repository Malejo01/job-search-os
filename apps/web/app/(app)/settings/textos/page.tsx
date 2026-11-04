import { AYUDA_EN_CONTEXTO, TEXTOS_ANI, type TextoAni } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canCreateInvitations } from "@/lib/invitations";
import { requireUserId } from "@/lib/session";
import { alertClasses } from "@/components/ui";
import { welcomeEmailSample } from "@/lib/welcome-email-sample";

export const metadata: Metadata = { title: "Textos para revisar", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Textos para Ani (C8-18): los textos públicos clave en una sola página, cada uno con su archivo de
 * origen y lo que hay que decidir. Solo para quien administra la beta (las mismas cuentas que invitan);
 * para el resto, 404. La lista vive en `packages/pipeline/src/textos-ani.ts`; un test verifica que cada
 * extracto siga existiendo en su archivo.
 */
export default async function TextosPage() {
  const userId = await requireUserId();
  if (!(await canCreateInvitations(userId).catch(() => false))) notFound();
  const areas = [...new Set(TEXTOS_ANI.map((t) => t.area))];
  const email = welcomeEmailSample();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-bold">Textos para revisar</h1>
        <p className="text-sm text-fg-muted">
          Los textos públicos clave en un solo lugar. Cada uno dice en qué archivo vive: un cambio
          es un PR chico. La guía con qué decidir en cada uno está en{" "}
          <code>docs/beta/textos-para-ani.md</code>.
        </p>
      </div>

      {areas.map((area) => (
        <section
          key={area}
          aria-labelledby={`textos-${slug(area)}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`textos-${slug(area)}`} className="text-heading font-bold">
            {area}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {TEXTOS_ANI.filter((t) => t.area === area).map((t) => (
              <TextoItem key={`${t.area}-${t.nombre}`} texto={t} />
            ))}
          </ul>
        </section>
      ))}

      <section aria-labelledby="textos-ayuda" className="flex flex-col gap-3">
        <h2 id="textos-ayuda" className="text-heading font-bold">
          «¿Qué es esto?» completo (C8-6)
        </h2>
        <p className="text-sm text-fg-muted">
          Archivo: <code>packages/pipeline/src/help/ayuda-en-contexto.ts</code>
        </p>
        {Object.values(AYUDA_EN_CONTEXTO).map((a) => (
          <div key={a.tema} className="flex flex-col gap-1 rounded-card bg-surface p-4">
            <h3 className="text-sm font-bold text-fg">{a.tema}</h3>
            {a.parrafos.map((p) => (
              <p key={p} className="text-sm text-fg-muted">
                {p}
              </p>
            ))}
          </div>
        ))}
      </section>

      <section aria-labelledby="textos-email" className="flex flex-col gap-3">
        <h2 id="textos-email" className="text-heading font-bold">
          Email de bienvenida (C8-7)
        </h2>
        <p className="text-sm">
          <span className="font-semibold">Asunto:</span> {email.subject}
        </p>
        <pre className="overflow-x-auto rounded-card bg-surface p-4 font-sans text-sm whitespace-pre-wrap text-fg">
          {email.text}
        </pre>
      </section>
    </div>
  );
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function TextoItem({ texto: t }: { texto: TextoAni }) {
  return (
    <li className="flex flex-col gap-2 rounded-card bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-fg">{t.nombre}</h3>
        {t.verEn ? (
          <Link href={t.verEn} className="font-semibold text-link underline">
            Ver en {t.verEn}
          </Link>
        ) : null}
      </div>
      {t.extracto ? (
        <blockquote className="m-0 border-l-4 border-line-strong pl-3 text-fg">
          {t.extracto}
        </blockquote>
      ) : (
        <p className="text-fg-muted">Se arma en el código: mirá el archivo.</p>
      )}
      <p className="text-xs text-fg-subtle">
        Archivo: <code>{t.archivo}</code>
      </p>
      {t.decidir ? (
        <p className={alertClasses({ tone: "warning" })}>
          <span className="font-bold">Para decidir:</span> {t.decidir}
        </p>
      ) : null}
    </li>
  );
}
