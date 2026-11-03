import { BRAND, BRAND_COLORS } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo, type LogoTone } from "@/components/brand/logo";
import { OfferCard } from "@/components/offer-card";
import {
  Alert,
  Badge,
  Button,
  Field,
  Icon,
  ICON_PATHS,
  Seal,
  textLinkClasses,
  type BadgeTone,
  type IconName,
} from "@/components/ui";
import { canCreateInvitations } from "@/lib/invitations";
import { welcomeEmailSample } from "@/lib/welcome-email-sample";
import { requireUserId } from "@/lib/session";
import { TokenValue } from "./token-value";

export const metadata: Metadata = { title: "Marca", robots: { index: false } };
export const dynamic = "force-dynamic";

const TOKENS: Array<[string, string]> = [
  ["canvas", "bg-canvas"],
  ["surface", "bg-surface"],
  ["surface-muted", "bg-surface-muted"],
  ["line", "bg-line"],
  ["fg", "bg-fg"],
  ["fg-muted", "bg-fg-muted"],
  ["fg-subtle", "bg-fg-subtle"],
  ["brand", "bg-brand"],
  ["brand-text", "bg-brand-text"],
  ["link", "bg-link"],
  ["focus", "bg-focus"],
  ["ink", "bg-ink"],
  ["success-muted", "bg-success-muted"],
  ["warning-muted", "bg-warning-muted"],
  ["danger-muted", "bg-danger-muted"],
  ["info-muted", "bg-info-muted"],
];

const BADGES: Array<[BadgeTone, string]> = [
  ["neutral", "Evaluada"],
  ["info", "LinkedIn (email)"],
  ["success", "Ubicación ok"],
  ["warning", "Riesgo: sueldo no publicado"],
  ["danger", "Impide postular: 1 motivo"],
];

const LOGO_BACKGROUNDS: Array<[LogoTone, string, string]> = [
  ["auto", "bg-surface", "Acompaña al modo"],
  ["light", "light bg-canvas", "Sobre claro"],
  ["dark", "bg-ink", "Sobre oscuro"],
  ["accent", "bg-brand", "Sobre lima"],
];

/**
 * Vitrina de marca para revisar (reserva R-1): logo, paleta, tipografías y todos los componentes con
 * sus estados, en claro y en oscuro lado a lado, para que Ani revise la marca en un solo lugar. Solo
 * para las cuentas que administran la beta (las mismas que invitan); para el resto, 404. Sin datos de
 * nadie: los textos son de ejemplo.
 */
export default async function MarcaPage() {
  const userId = await requireUserId();
  if (!(await canCreateInvitations(userId).catch(() => false))) notFound();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-title font-bold">Marca</h1>
        <p className="text-sm text-fg-muted">
          Logo, colores, tipografías y componentes de {BRAND.name}, en claro y en oscuro. Lo que se
          cambie sale de los tokens de <code>globals.css</code> y de un solo componente de logo (ver
          docs/MARCA.md).
        </p>
        <p className="mt-1 text-sm">
          <Link href="/settings/marca/componentes" className={textLinkClasses({ block: true })}>
            Ver los componentes del rediseño en todos sus estados
          </Link>
        </p>
      </div>

      <section aria-labelledby="marca-logo" className="flex flex-col gap-3">
        <h2 id="marca-logo" className="text-heading font-bold">
          Logo
        </h2>
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {LOGO_BACKGROUNDS.map(([tone, bg, label]) => (
            <li
              key={tone}
              data-logo-fondo={tone}
              className={`flex flex-col items-start gap-3 rounded-card border border-line p-5 ${bg}`}
            >
              <Logo tone={tone} size="md" decorative />
              <span className="flex items-center gap-3">
                <Logo tone={tone} variant="mark" size="md" decorative />
                <Logo tone={tone} variant="wordmark" size="sm" decorative />
              </span>
              <span
                className={`rounded-badge bg-surface px-2 py-0.5 text-xs font-semibold text-fg ${tone === "auto" ? "" : "shadow-sm"}`}
              >
                {label}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-fg-subtle">
          Colores fijos fuera de CSS (imágenes OG, manifest, emails): índigo {BRAND_COLORS.ink},
          lima {BRAND_COLORS.accent}, índigo vivo {BRAND_COLORS.accentDeep}.
        </p>
      </section>

      <WelcomeEmailPreview />

      <div className="grid gap-4 lg:grid-cols-2">
        {(["light", "dark"] as const).map((mode) => (
          <section
            key={mode}
            aria-labelledby={`marca-${mode}`}
            className={`${mode} flex min-w-0 flex-col gap-5 rounded-card border border-line bg-canvas p-4 text-fg`}
          >
            <h2 id={`marca-${mode}`} className="text-heading font-bold">
              {mode === "light" ? "Claro" : "Oscuro"}
            </h2>
            <ModePanel />
          </section>
        ))}
      </div>
    </div>
  );
}

/** Todo lo que cambia con el modo. Va dos veces: dentro de `.light` y dentro de `.dark`. */
function ModePanel() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">Colores</h3>
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
          {TOKENS.map(([name, bg]) => (
            <li key={name} className="flex flex-col gap-1">
              <span
                aria-hidden="true"
                className={`h-10 rounded-control border border-line ${bg}`}
              />
              <span className="text-xs font-semibold">{name}</span>
              <TokenValue name={name} />
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-bold">Tipografías</h3>
        <p className="font-display text-4xl leading-tight font-extrabold tracking-tight">
          Ofertas afines.
        </p>
        <p className="font-display text-2xl font-bold">
          Título de página · Bricolage Grotesque 700
        </p>
        <p className="font-display text-xl font-medium">
          Bricolage Grotesque 500 · el «Jobs» del logo
        </p>
        <p className="font-display text-xl font-extrabold">Bricolage Grotesque 800 · el sello</p>
        <p className="text-base font-extrabold">Botón · Figtree 800</p>
        <p className="text-base">Texto · Figtree 500: leemos cada oferta contra tu perfil.</p>
        <p className="text-xs font-semibold text-fg-subtle">Apoyo · Figtree 600 · 12/16</p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">Botones</h3>
        <div className="flex flex-wrap gap-2">
          <Button>+ Cargar oferta</Button>
          <Button variant="secondary">Ver detalle</Button>
          <Button variant="dark">Guardar y evaluar</Button>
          <Button disabled>Cerrada</Button>
          <Button variant="ghost">Ahora no</Button>
          <Button variant="danger">Eliminar</Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">Campos</h3>
        <Field label="Puesto" placeholder="Analista contable" />
        <Field
          label="Descripción"
          multiline
          placeholder="Pegá acá la descripción completa del puesto"
        />
        <Field label="Email" defaultValue="no es un email" error="El email no es válido." />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">Avisos</h3>
        <Alert tone="success" role={null}>
          Descripción guardada: la oferta queda en cola para evaluar.
        </Alert>
        <Alert tone="warning" role={null}>
          Llegaste al tope diario de evaluaciones.
        </Alert>
        <Alert tone="danger" role={null}>
          La descripción es muy corta (mínimo 200 caracteres).
        </Alert>
        <Alert tone="info" role={null}>
          En cola para evaluar.
        </Alert>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">Score y etiquetas</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Seal score={8.5} />
          <Seal score={7.5} />
          <Seal score={5.5} />
          <Seal score={3} />
          <Seal score={1.5} />
          <Seal score={null} preScore={6} />
          <Seal score={null} pending />
          <Seal score={null} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {BADGES.map(([tone, label]) => (
            <Badge key={label} shape="square" tone={tone}>
              {label}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">Íconos</h3>
        <ul className="m-0 grid list-none grid-cols-4 gap-2 p-0 sm:grid-cols-6">
          {(Object.keys(ICON_PATHS) as IconName[]).map((name) => (
            <li
              key={name}
              className="flex flex-col items-center gap-1 rounded-control bg-surface-muted p-2 text-[11px] font-semibold"
            >
              <Icon name={name} />
              {name}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">Tarjeta de oferta</h3>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          <OfferCard
            href="/settings/marca"
            title="Analista contable semi senior"
            meta={["Empresa de ejemplo", "Salta", "28 oct"]}
            score={8.5}
            tags={[
              { label: "Evaluada", tone: "neutral" },
              { label: "Ubicación ok", tone: "success" },
            ]}
          />
        </ul>
      </div>
    </>
  );
}

/**
 * Vista previa del email de bienvenida (C8-7) con datos de ejemplo: el texto acá y el HTML con la
 * marca en `/settings/marca/email-bienvenida` (HTML propio, sin scripts). Sin iframe: axe no puede
 * entrar a un iframe sin permisos y la página dejaría de medirse.
 */
function WelcomeEmailPreview() {
  const { subject, text } = welcomeEmailSample();
  return (
    <section
      aria-labelledby="marca-email"
      className="flex flex-col gap-3"
      data-testid="marca-email"
    >
      <h2 id="marca-email" className="text-heading font-bold">
        Email de bienvenida
      </h2>
      <p className="text-sm text-fg-muted">
        Sale una sola vez cuando activás el plan de alguien (no al renovarlo), si
        <code> WELCOME_EMAIL_ENABLED=1</code>. Datos de ejemplo.
      </p>
      <p className="text-sm">
        <span className="font-semibold">Asunto:</span> {subject}
      </p>
      <pre className="max-w-xl overflow-x-auto rounded-card bg-surface p-4 font-sans text-sm whitespace-pre-wrap text-fg">
        {text}
      </pre>
      <a
        href="/settings/marca/email-bienvenida"
        target="_blank"
        rel="noopener"
        className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-link underline"
      >
        Ver con el diseño (se abre aparte)
      </a>
    </section>
  );
}
