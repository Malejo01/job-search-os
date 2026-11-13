import { ILLUSTRATIONS, type IllustrationScene } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  buttonClasses,
  Card,
  CheckMark,
  Chip,
  EmptyState,
  Field,
  filterChipClasses,
  Icon,
  ICON_PATHS,
  Seal,
  textLinkClasses,
  type IconName,
} from "@/components/ui";
import { Illustration } from "@/components/brand/illustration";
import { Logo } from "@/components/brand/logo";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { requireUserId } from "@/lib/session";

export const metadata: Metadata = { title: "Componentes", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Catálogo de primitivas del rediseño (C9-3; piezas exactas de los tableros aprobados el 4/11 en
 * C10-2): cada una en todos sus estados, en claro y en oscuro lado a lado. Es lo que Mauro revisa en la vista previa antes de mirar las pantallas. Solo para las
 * cuentas que administran la beta (las mismas que invitan); para el resto, 404. Sin datos de nadie:
 * los textos son de ejemplo y las empresas, inventadas.
 *
 * Los botones no hacen nada (no tienen `onClick`): se pueden tocar para ver el hundimiento.
 */
export default async function ComponentesPage() {
  const userId = await requireUserId();
  await requireAdminOr404(userId);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-bold">Componentes</h1>
        <p className="text-sm text-fg-muted">
          Las primitivas del rediseño en todos sus estados, en claro y en oscuro. Tocá un botón, un
          chip o una tarjeta para ver cómo se hunde. Las reglas están en{" "}
          <code>docs/ux/tokens.md</code>; el logo, la paleta y las tipografías, en{" "}
          <Link href="/settings/marca" className={textLinkClasses()}>
            Marca
          </Link>
          .
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel mode="light" />
        <Panel mode="dark" />
      </div>
    </div>
  );
}

function Panel({ mode }: { mode: "light" | "dark" }) {
  const id = (s: string) => `componentes-${mode}-${s}`;
  const label = mode === "light" ? "claro" : "oscuro";
  return (
    <section
      aria-labelledby={id("titulo")}
      className={`${mode} flex min-w-0 flex-col gap-6 rounded-container bg-canvas p-4 text-fg sm:p-6`}
      data-testid={`componentes-${mode}`}
    >
      <h2 id={id("titulo")} className="text-heading font-bold">
        En {label}
      </h2>

      <Block title="Logo sobre índigo" id={id("logo")}>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-card bg-ink px-5 py-4">
          <Logo tone="dark" />
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-pill bg-ink-accent text-base font-extrabold text-on-ink"
          >
            L
          </span>
        </div>
      </Block>

      <Block title="Tarjeta de oferta" id={id("oferta")}>
        <Card
          level="featured"
          padding="none"
          className="flex items-start gap-3.5 py-[18px] pr-[18px] pl-5"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
            <p className="font-display text-[19px] font-bold">Analista contable semi senior</p>
            <p className="text-sm font-medium text-fg-subtle">Estudio Ruiz y Asociados, en Salta</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip tone="have" srLabel="Tenés">
                Liquidación de sueldos
              </Chip>
              <Chip tone="have" srLabel="Tenés">
                IVA y Ganancias
              </Chip>
              <Chip tone="missing">Te falta: Tango</Chip>
            </div>
            <p className="text-xs font-semibold text-fg-subtle">
              4 a tu favor, 1 te falta · Presencial · hace 2 días
            </p>
          </div>
          <Seal score={8.5} size="featured" />
        </Card>
        <Card level="list" padding="none" className="flex items-start gap-3.5 py-4 pr-[18px] pl-5">
          <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
            <p className="font-display text-[17px] font-bold">Liquidador de sueldos</p>
            <p className="text-sm font-medium text-fg-subtle">Grupo Norte, remoto en Argentina</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip tone="have" srLabel="Tenés">
                Convenios colectivos
              </Chip>
              <Chip tone="missing">Te falta: inglés intermedio</Chip>
            </div>
          </div>
          <Seal score={7.4} />
        </Card>
      </Block>

      <Block title="Sello de afinidad" id={id("sello")}>
        <div className="flex flex-wrap items-center gap-4" data-testid={`sellos-${mode}`}>
          <Seal score={9.2} />
          <Seal score={7.5} />
          <Seal score={5.5} />
          <Seal score={3.5} />
          <Seal score={1.5} />
          <Seal score={null} preScore={6} />
          <Seal score={null} />
          <Seal score={null} pending />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Seal score={8.5} size="featured" />
          <Seal score={6.1} size="featured" />
          <Seal score={8.8} size="detail" />
          <Seal score={2.4} size="detail" />
          <Seal score={null} pending size="detail" />
          <p className="text-sm text-fg-muted">Leyendo la oferta contra tu perfil…</p>
        </div>
      </Block>

      <Block title="Botones" id={id("botones")}>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Ver mis ofertas</Button>
          <Button variant="secondary">Ver el aviso</Button>
          <Button variant="dark">Guardar y evaluar</Button>
          <Button variant="ghost">Ahora no</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Guardar</Button>
          <Button size="sm" variant="secondary">
            Copiar
          </Button>
          <Button size="sm" variant="danger">
            Borrar cuenta
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled>Guardar descripción</Button>
          <Button variant="secondary" aria-disabled="true">
            Sin cambios
          </Button>
          <Link
            href="/settings/marca/componentes"
            className={buttonClasses({ variant: "secondary" })}
          >
            Un link con forma de botón
          </Link>
        </div>
      </Block>

      <Block title="Tarjetas" id={id("tarjetas")}>
        <Card>
          <p className="font-semibold">Panel (flat)</p>
          <p className="text-sm text-fg-muted">No se toca: sin borde inferior.</p>
        </Card>
        <Card level="list" pressable>
          <p className="font-semibold">Tarjeta de lista (list, 4 px)</p>
          <p className="text-sm text-fg-muted">Se toca y se hunde 3 px.</p>
        </Card>
        <Card level="featured" pressable padding="md">
          <p className="font-display text-lg font-bold">Tarjeta destacada (featured, 6 px)</p>
          <p className="text-sm text-fg-muted">Una por pantalla: la oferta principal de Hoy.</p>
        </Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card tone="success">
            <p className="text-sm font-semibold text-success">Panel de éxito</p>
          </Card>
          <Card tone="warning">
            <p className="text-sm font-semibold text-warning">Panel de riesgo</p>
          </Card>
        </div>
      </Block>

      <Block title="Chips y filtros" id={id("chips")}>
        <div className="flex flex-wrap gap-2">
          <Chip tone="have" srLabel="Tenés">
            Liquidación de sueldos
          </Chip>
          <Chip tone="have" srLabel="Tenés">
            Excel avanzado
          </Chip>
          <Chip tone="missing" srLabel="Te falta">
            Tango Gestión
          </Chip>
          <Chip tone="missing">Te falta: Tango</Chip>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed="true"
            className={filterChipClasses({ selected: true, compact: true })}
          >
            Para revisar · 12
          </button>
          <button
            type="button"
            aria-pressed="false"
            className={filterChipClasses({ compact: true })}
          >
            Guardadas · 3
          </button>
          <button
            type="button"
            aria-pressed="false"
            className={filterChipClasses({ compact: true })}
          >
            Remoto
          </button>
        </div>
      </Block>

      <Block title="Checks" id={id("checks")}>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          <li className="flex items-center gap-2.5">
            <CheckMark done />
            <span className="text-[15px] font-semibold text-fg-subtle line-through">
              Subir tu CV
            </span>
          </li>
          <li className="flex items-center gap-2.5">
            <CheckMark done={false} />
            <span className="text-[15px] font-bold">Pegar la descripción de 2 ofertas</span>
          </li>
          <li className="flex items-center gap-2.5">
            <CheckMark done>1</CheckMark>
            <span className="text-sm font-bold">Contanos tu carrera</span>
          </li>
        </ul>
      </Block>

      <Block title="Campos" id={id("campos")}>
        <Field label="Tu nombre" placeholder="Lucía" />
        <Field label="Email" hint="Te escribimos solo para avisarte de ofertas." type="email" />
        <Field
          label="Años de experiencia"
          error="Poné un número, por ejemplo 3."
          defaultValue="tres"
        />
        <Field multiline label="Descripción del aviso" placeholder="Pegá el texto del aviso" />
      </Block>

      <Block title="Avisos" id={id("avisos")}>
        <Alert tone="success" role={null} title="Listo">
          Guardamos tu perfil.
        </Alert>
        <Alert tone="info" role={null}>
          Leemos cada oferta contra tu perfil: vos decidís.
        </Alert>
        <Alert tone="warning" role={null}>
          El aviso no dice el país: revisalo antes de postular.
        </Alert>
        <Alert tone="danger" role={null} title="No pudimos guardar la descripción">
          Tu texto sigue acá: revisá la conexión y tocá Guardar otra vez.
        </Alert>
      </Block>

      <Block title="Etiquetas" id={id("etiquetas")}>
        <div className="flex flex-wrap gap-2">
          <Badge>Evaluada</Badge>
          <Badge tone="info">LinkedIn (email)</Badge>
          <Badge tone="success">Ubicación ok</Badge>
          <Badge tone="warning">Sueldo no publicado</Badge>
          <Badge tone="danger" emphasis="muted">
            Impide postular
          </Badge>
          <Badge tone="info" emphasis="strong">
            3
          </Badge>
        </div>
      </Block>

      <Block title="Estado vacío" id={id("vacio")}>
        <EmptyState
          title="Todavía no llegó nada"
          action={
            <Link href="/settings/perfil" className={buttonClasses()}>
              Elegir mis áreas
            </Link>
          }
        >
          Estamos buscando todos los días. Mientras, dejá tu perfil a punto.
        </EmptyState>
      </Block>

      <Block title="Ilustraciones" id={id("ilustraciones")}>
        <p className="text-sm text-fg-muted">
          Las ocho escenas; las que todavía no tienen imagen muestran el marcador del mismo tamaño.
          «hoy» y «acceso» van sobre la cabecera índigo.
        </p>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(Object.keys(ILLUSTRATIONS) as IllustrationScene[]).map((scene) => (
            <li
              key={scene}
              className={`flex flex-col items-center gap-1 rounded-card p-2 text-center ${
                ILLUSTRATIONS[scene].background === "ink" ? "bg-ink text-on-ink" : ""
              }`}
            >
              <Illustration escena={scene} className="w-full" />
              <span className="text-[11px] font-bold">{scene}</span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Íconos" id={id("iconos")}>
        <ul className="flex flex-wrap gap-3 text-fg">
          {(Object.keys(ICON_PATHS) as IconName[]).map((name) => (
            <li key={name} className="flex w-20 flex-col items-center gap-1 text-center">
              <Icon name={name} />
              <span className="text-[11px] text-fg-subtle">{name}</span>
            </li>
          ))}
        </ul>
      </Block>
    </section>
  );
}

function Block({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-sm font-bold text-fg-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}
