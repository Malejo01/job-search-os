import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { OfferCard } from "@/components/offer-card";
import {
  Alert,
  Badge,
  Button,
  buttonClasses,
  Card,
  EmptyState,
  Field,
  Icon,
  ICON_PATHS,
  ScoreBadge,
  textLinkClasses,
  type BadgeTone,
  type ButtonVariant,
  type IconName,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Componentes", robots: { index: false } };

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "dark", "ghost", "danger"];
const BADGE_TONES: BadgeTone[] = ["neutral", "success", "warning", "danger", "info", "brand"];

/**
 * Vitrina de los componentes base (N3-3): cada variante en una pantalla, para revisarlos a ojo y
 * para que el e2e 87 los pase por axe en claro y en oscuro. Sin datos de nadie y fuera del menú.
 */
export default function UiPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-title font-semibold">Componentes</h1>
        <p className="text-sm text-fg-subtle">
          Los componentes base de la app, con todas sus variantes. Ver docs/ux/tokens.md.
        </p>
      </div>

      <section aria-labelledby="ui-botones" className="flex flex-col gap-2">
        <h2 id="ui-botones" className="text-heading font-semibold">
          Botones
        </h2>
        {(["md", "sm"] as const).map((size) => (
          <div key={size} className="flex flex-wrap items-center gap-3">
            {VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} size={size}>
                {`${variant} ${size}`}
              </Button>
            ))}
            <Button size={size} disabled>
              {`deshabilitado ${size}`}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/hoy" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Link con forma de botón
          </Link>
          <Link href="/hoy" className={textLinkClasses({ block: true })}>
            Link de tarjeta
          </Link>
          <p className="text-sm text-fg-muted">
            Texto con un{" "}
            <Link href="/hoy" className={textLinkClasses()}>
              link adentro
            </Link>
            .
          </p>
        </div>
      </section>

      <section aria-labelledby="ui-logo" className="flex flex-col gap-2">
        <h2 id="ui-logo" className="text-heading font-semibold">
          Logo
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <Logo size="md" />
          <Logo variant="mark" size="md" />
          <Logo variant="wordmark" size="md" />
          <span className="inline-flex rounded-card border border-ink-line bg-ink p-3">
            <Logo tone="dark" />
          </span>
        </div>
      </section>

      <section aria-labelledby="ui-campos" className="flex flex-col gap-2">
        <h2 id="ui-campos" className="text-heading font-semibold">
          Campos
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Título del puesto"
            placeholder="Analista contable"
            hint="Como dice el aviso."
          />
          <Field label="Empresa" defaultValue="" error="Falta la empresa." />
          <Field
            multiline
            label="Descripción"
            placeholder="Pegá acá la descripción completa del puesto"
            className="sm:col-span-2"
          />
        </div>
      </section>

      <section aria-labelledby="ui-score" className="flex flex-col gap-2">
        <h2 id="ui-score" className="text-heading font-semibold">
          Score
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <ScoreBadge score={8.5} />
          <ScoreBadge score={5.5} />
          <ScoreBadge score={3} />
          <ScoreBadge score={null} preScore={6} />
          <ScoreBadge score={null} pending />
          <ScoreBadge score={null} />
          <ScoreBadge score={8} size="sm" />
          <ScoreBadge score={8} size="lg" />
        </div>
      </section>

      <section aria-labelledby="ui-iconos" className="flex flex-col gap-2">
        <h2 id="ui-iconos" className="text-heading font-semibold">
          Íconos
        </h2>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {(Object.keys(ICON_PATHS) as IconName[]).map((name) => (
            <li
              key={name}
              className="flex flex-col items-center gap-1 rounded-card bg-surface-muted p-3 text-xs font-semibold"
            >
              <Icon name={name} />
              {name}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ui-oferta" className="flex flex-col gap-2">
        <h2 id="ui-oferta" className="text-heading font-semibold">
          Tarjeta de oferta
        </h2>
        <ul className="flex flex-col gap-2">
          <OfferCard
            href="/ui"
            title="Analista contable semi senior"
            meta={["Empresa de ejemplo", "Salta", "28 oct"]}
            score={8.5}
            tags={[
              { label: "Evaluada", tone: "neutral" },
              { label: "Ubicación ok", tone: "success" },
            ]}
          />
          <OfferCard
            href="/ui"
            title="Asistente de administración"
            meta={["Otra empresa", "Jujuy"]}
            score={null}
            pending
            tags={[{ label: "En cola", tone: "info" }]}
          />
        </ul>
      </section>

      <section aria-labelledby="ui-badges" className="flex flex-col gap-2">
        <h2 id="ui-badges" className="text-heading font-semibold">
          Badges
        </h2>
        {(["soft", "muted", "strong"] as const).map((emphasis) =>
          (["pill", "square"] as const).map((shape) => (
            <div key={`${emphasis}-${shape}`} className="flex flex-wrap gap-2">
              {BADGE_TONES.map((tone) => (
                <Badge key={tone} tone={tone} emphasis={emphasis} shape={shape}>
                  {`${tone} ${emphasis}`}
                </Badge>
              ))}
            </div>
          )),
        )}
      </section>

      <section aria-labelledby="ui-tarjetas" className="flex flex-col gap-2">
        <h2 id="ui-tarjetas" className="text-heading font-semibold">
          Tarjetas
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card as="article">
            <h3 className="font-semibold">Tarjeta</h3>
            <p className="text-sm text-fg-muted">Fondo de superficie, borde y padding chico.</p>
          </Card>
          <Card as="article" surface="none" padding="md">
            <h3 className="font-semibold">Sin fondo</h3>
            <p className="text-sm text-fg-subtle">Deja ver el fondo de la página.</p>
          </Card>
          {(["success", "warning", "danger", "info"] as const).map((tone) => (
            <Card key={tone} as="article" tone={tone}>
              <h3 className="font-semibold">{`Tono ${tone}`}</h3>
              <p className="text-sm">Panel con significado.</p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="ui-avisos" className="flex flex-col gap-2">
        <h2 id="ui-avisos" className="text-heading font-semibold">
          Avisos
        </h2>
        <Alert tone="info" role="note" title="Información">
          Un aviso fijo de la página.
        </Alert>
        <Alert tone="success" role="status">
          Guardado. Los cambios ya se ven en tus ofertas.
        </Alert>
        <Alert tone="warning" role={null} bordered>
          Este aviso pide residir en otro país.
        </Alert>
        <Alert
          tone="danger"
          role="alert"
          bordered
          title="No se pudo guardar"
          action={
            <Button variant="secondary" size="sm">
              Reintentar
            </Button>
          }
        >
          Probá de nuevo en un rato.
        </Alert>
      </section>

      <section aria-labelledby="ui-vacios" className="flex flex-col gap-2">
        <h2 id="ui-vacios" className="text-heading font-semibold">
          Estados vacíos
        </h2>
        <EmptyState
          title="Todavía no hay ofertas"
          action={
            <Link href="/jobs/new" className={textLinkClasses({ block: true })}>
              Pegá una oferta
            </Link>
          }
        >
          Las buscamos todos los días.
        </EmptyState>
        <Card surface="none">
          <EmptyState
            variant="inline"
            action={
              <Link href="/applications" className={textLinkClasses({ block: true })}>
                Ver mis postulaciones
              </Link>
            }
          >
            Nada pendiente.
          </EmptyState>
        </Card>
      </section>
    </div>
  );
}
