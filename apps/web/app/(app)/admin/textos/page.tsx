import {
  AYUDA_EN_CONTEXTO,
  contarTextosAprobados,
  estadoDeTexto,
  TEXTOS_ANI,
  type TextoAni,
} from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { requireUserId } from "@/lib/session";
import { alertClasses } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { TextosAprobacionPanel } from "@/components/textos-aprobacion-panel";
import { textosRediseno } from "@/lib/textos-aprobacion";
import { TEXTOS_APROBACION } from "@/lib/textos-revision";
import { textReviewLatest } from "@/lib/textos-revisiones";
import { welcomeEmailSample } from "@/lib/welcome-email-sample";
import { reviewTextoAction } from "../../settings/textos/actions";

export const metadata: Metadata = { title: "Textos para revisar", robots: { index: false } };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

/**
 * Textos para Ani (C8-18): los textos públicos clave en una sola página, cada uno con su archivo de
 * origen y lo que hay que decidir. Solo para quien administra la beta (las mismas cuentas que invitan);
 * para el resto, 404. La lista vive en `packages/pipeline/src/textos-ani.ts`; un test verifica que cada
 * extracto siga existiendo en su archivo.
 */
export default async function TextosPage() {
  const userId = await requireUserId();
  await requireAdminOr404(userId);
  const areas = [...new Set(TEXTOS_ANI.map((t) => t.area))];
  const email = welcomeEmailSample();
  // R26-02: los textos del rediseño. Si la lectura falla (migración sin aplicar), se ven sin botones
  const textos = textosRediseno();
  const latest = await textReviewLatest(userId).catch(() => null);
  const resumen = latest ? contarTextosAprobados(textos, latest) : null;
  const propuestas = latest
    ? [...latest.values()].flatMap((r) => {
        const texto = textos.find((t) => t.clave === r.clave);
        return r.estado === "propuesta" && r.proposal && texto
          ? [{ review: r, texto, vieja: estadoDeTexto(texto.huella, r) === "propuesta_vieja" }]
          : [];
      })
    : [];
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

      <section aria-labelledby="textos-propuestas" className="flex flex-col gap-3">
        <h2 id="textos-propuestas" className="text-heading font-bold">
          {TEXTOS_APROBACION.propuestasTitulo}
        </h2>
        <p className="text-sm text-fg-muted">{TEXTOS_APROBACION.propuestasAyuda}</p>
        {propuestas.length === 0 ? (
          <p className="text-sm text-fg-muted" data-testid="propuestas-vacia">
            {TEXTOS_APROBACION.propuestasVacia}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="propuestas">
            {propuestas.map(({ review, texto, vieja }) => (
              <li
                key={texto.clave}
                className="flex flex-col gap-2 rounded-card bg-surface p-4 text-sm"
                data-testid={`propuesta-${texto.clave}`}
              >
                <code className="text-xs text-fg-subtle">{texto.clave}</code>
                <p className="m-0 text-fg-muted">
                  {TEXTOS_APROBACION.actual}: «{texto.valor}»
                </p>
                <blockquote
                  className="m-0 border-l-4 border-line-strong pl-3 text-fg"
                  data-testid="propuesta-texto"
                >
                  {review.proposal}
                </blockquote>
                <p className="m-0 text-xs text-fg-subtle">
                  {review.reviewerEmail ?? "Cuenta borrada"} · {DATE.format(review.createdAt)}
                  {vieja ? ` · ${TEXTOS_APROBACION.propuestaVieja}` : ""}
                </p>
                <CopyButton
                  text={review.proposal ?? ""}
                  label={TEXTOS_APROBACION.copiar}
                  copiedLabel={TEXTOS_APROBACION.copiado}
                  testId="propuesta-copiar"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="textos-rediseno" className="flex flex-col gap-3">
        <h2 id="textos-rediseno" className="text-heading font-bold">
          {TEXTOS_APROBACION.titulo}
        </h2>
        <p className="text-sm text-fg-muted">{TEXTOS_APROBACION.introAdmin}</p>
        {resumen ? (
          <p className="text-sm font-semibold" data-testid="textos-resumen">
            {TEXTOS_APROBACION.resumen(resumen.aprobados, resumen.total)}
          </p>
        ) : null}
        <TextosAprobacionPanel textos={textos} latest={latest} action={reviewTextoAction} />
      </section>

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
