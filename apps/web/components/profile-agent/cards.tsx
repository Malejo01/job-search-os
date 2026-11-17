"use client";

import {
  PROFILE_AGENT_API,
  profileAgentPath,
  profileReadFallbacks,
  type ProfileAgentBase,
  type ProfileCardDecision,
  type ProfileReadCard,
  type ProfileReadProposal,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { useState } from "react";
import { Alert, buttonClasses, cardClasses, inputClasses } from "@/components/ui";

/**
 * Tarjetas por sección (ADR-034 §2, R10-2): experiencia (de a un trabajo), estudios, skills con nivel e
 * idiomas. Cada una se edita y se acepta o se descarta. Cliente: el estado vive en memoria de esta
 * pantalla (la lectura no se guarda); al guardar, el servidor vuelve a validar y filtrar todo y guarda solo
 * lo aceptado, con la misma validación que la carga manual. Lo que el CV no dice queda vacío.
 */
type Mark = "accept" | "discard";
type Status =
  | "saved"
  | "updated"
  | "unchanged"
  | "duplicate"
  | "limit"
  | "slug_unknown"
  | "no_profile"
  | "preview_only";

type SaveResponse =
  | {
      ok: true;
      saved: { id: string; status: Status }[];
      rejected: { id: string; reason: string; message: string }[];
      discarded: string[];
    }
  | { ok: false; error: string; message: string };

/** Qué le decimos a la persona de cada resultado; `done` = la tarjeta queda resuelta y no se edita más. */
const STATUS_TEXT: Record<Status, { text: string; done: boolean }> = {
  saved: { text: "Guardada en tu perfil.", done: true },
  updated: { text: "Actualizada en tu perfil.", done: true },
  unchanged: { text: "Ya lo tenías así.", done: true },
  duplicate: { text: "Ya estaba cargada: no la repetimos.", done: true },
  limit: {
    text: "Llegaste al tope de tu perfil. Quitá algo desde Ajustes y volvé a intentar.",
    done: false,
  },
  slug_unknown: { text: "Esa skill no está en la lista.", done: false },
  no_profile: {
    text: "Todavía no podemos guardar este dato: completá tu perfil primero.",
    done: false,
  },
  preview_only: {
    text: "Solo el inglés con nivel se guarda en el perfil; este idioma va en la vista previa de tu CV.",
    done: true,
  },
};

const LEVELS = [
  { value: 1, label: "Básico" },
  { value: 2, label: "Productivo" },
  { value: 3, label: "Fuerte" },
] as const;

const FIELD = inputClasses();
const PRIMARY = buttonClasses();
const SECONDARY = buttonClasses({ variant: "secondary" });
const SM = buttonClasses({ variant: "secondary", size: "sm" });
const SM_ON = buttonClasses({ size: "sm" });

const SECTIONS: { kind: ProfileReadCard["kind"]; title: string; empty: string }[] = [
  { kind: "experience", title: "Experiencia", empty: "No encontramos trabajos en tu CV." },
  { kind: "education", title: "Estudios", empty: "No encontramos estudios en tu CV." },
  { kind: "skill", title: "Skills", empty: "No encontramos skills en tu CV." },
  { kind: "language", title: "Idiomas", empty: "No encontramos idiomas en tu CV." },
];

export function ProfileCards({
  base,
  ticket,
  summaryLine,
  proposal,
  settled = false,
  onResolved,
}: {
  base: ProfileAgentBase;
  ticket: string;
  summaryLine: string;
  proposal: ProfileReadProposal;
  /** Volvió de una recarga y ya había resuelto tarjetas: sin tarjetas, no es que no se encontró nada. */
  settled?: boolean;
  /** Avisa qué tarjetas quedaron resueltas (guardadas o descartadas) para que no vuelvan al recargar. */
  onResolved?: (ids: string[]) => void;
}) {
  const [cards, setCards] = useState<ProfileReadCard[]>(proposal.cards);
  const [marks, setMarks] = useState<Record<string, Mark | undefined>>({});
  const [notes, setNotes] = useState<Record<string, { text: string; done: boolean } | undefined>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (id: string, change: Record<string, unknown>) =>
    setCards((all) => all.map((c) => (c.id === id ? ({ ...c, ...change } as ProfileReadCard) : c)));
  const mark = (id: string, m: Mark) => {
    setMarks((x) => ({ ...x, [id]: x[id] === m ? undefined : m }));
    setNotes((x) => ({ ...x, [id]: undefined }));
  };

  const decided = cards.filter((c) => marks[c.id] !== undefined && !notes[c.id]?.done);
  const next = profileAgentPath(base, "gaps");

  async function save() {
    if (busy || decided.length === 0) return;
    setBusy(true);
    setError(null);
    const decisions: ProfileCardDecision[] = decided.map((c) =>
      marks[c.id] === "accept"
        ? { id: c.id, decision: "accept", card: c }
        : { id: c.id, decision: "discard" },
    );
    let res: SaveResponse;
    try {
      const r = await fetch(PROFILE_AGENT_API.cards, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, decisions }),
      });
      res = (await r.json()) as SaveResponse;
    } catch {
      res = { ok: false, error: "network", message: "No hay conexión. Probá de nuevo." };
    }
    setBusy(false);
    if (!res.ok) return setError(res.message);
    const nextNotes: typeof notes = {};
    for (const s of res.saved) nextNotes[s.id] = STATUS_TEXT[s.status];
    for (const r of res.rejected) nextNotes[r.id] = { text: r.message, done: false };
    for (const id of res.discarded) nextNotes[id] = { text: "Descartada.", done: true };
    setNotes((n) => ({ ...n, ...nextNotes }));
    onResolved?.(
      Object.entries(nextNotes)
        .filter(([, note]) => note?.done === true)
        .map(([id]) => id),
    );
    // Lo que no se pudo guardar vuelve a quedar sin decidir, para que la persona lo corrija
    setMarks((m) => {
      const out = { ...m };
      for (const [id, note] of Object.entries(nextNotes))
        if (note && !note.done) out[id] = undefined;
      return out;
    });
  }

  const pending = cards.filter((c) => !notes[c.id]?.done).length;

  return (
    <div className="flex flex-col gap-5" data-testid="profile-cards">
      <section
        aria-labelledby="pa-leido"
        data-testid="profile-read-summary"
        className={cardClasses({ padding: "md", className: "flex flex-col gap-2" })}
      >
        <h2 id="pa-leido" className="text-base font-bold text-fg">
          Leímos tu CV
        </h2>
        <p className="text-sm text-fg">Encontramos {summaryLine}.</p>
        {proposal.dropped > 0 ? (
          <p className="text-sm text-fg-muted">
            {proposal.dropped === 1
              ? "1 dato se descartó"
              : `${proposal.dropped} datos se descartaron`}{" "}
            por seguridad o por no ser confiables.
          </p>
        ) : null}
        <p className="text-sm text-fg-muted">
          Revisá cada tarjeta, corregí lo que haga falta y tocá «Aceptar» o «Descartar». Solo se
          guarda lo que aceptes, y lo que el CV no dice queda vacío. Tu archivo y su texto no se
          guardan.
        </p>
      </section>

      {cards.length === 0 && settled ? (
        <Alert tone="info" role="status" data-testid="profile-cards-settled">
          Ya resolviste todas las tarjetas de esta lectura. Podés seguir con lo que falta.
        </Alert>
      ) : null}

      {cards.length === 0 && !settled ? (
        <Alert tone="warning" role="status">
          <p>No pudimos armar tarjetas con ese CV.</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {profileReadFallbacks(base).map((f) => (
              <li key={f.href}>
                <Link href={f.href} className="font-semibold underline underline-offset-2">
                  {f.label}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {SECTIONS.map((section) => {
        const list = cards.filter((c) => c.kind === section.kind);
        if (cards.length > 0 && list.length === 0) {
          return (
            <section key={section.kind} aria-label={section.title} className="flex flex-col gap-1">
              <h3 className="text-base font-bold text-fg">{section.title}</h3>
              <p className="text-sm text-fg-muted">{section.empty}</p>
            </section>
          );
        }
        if (list.length === 0) return null;
        return (
          <section key={section.kind} aria-label={section.title} className="flex flex-col gap-3">
            <h3 className="text-base font-bold text-fg">{section.title}</h3>
            <ul className="flex flex-col gap-3">
              {list.map((card) => {
                const note = notes[card.id];
                const locked = note?.done === true;
                const m = marks[card.id];
                return (
                  <li
                    key={card.id}
                    data-testid={`card-${card.id}`}
                    className={cardClasses({
                      level: "list",
                      padding: "sm",
                      className: `flex flex-col gap-3 ${locked ? "opacity-70" : ""}`,
                    })}
                  >
                    <CardFields
                      card={card}
                      disabled={locked || busy}
                      onChange={(c) => patch(card.id, c)}
                    />
                    {note ? (
                      <p
                        role="status"
                        className={`text-sm ${note.done ? "text-success" : "text-danger"}`}
                        data-testid={`card-note-${card.id}`}
                      >
                        {note.text}
                      </p>
                    ) : null}
                    {locked ? null : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          aria-pressed={m === "accept"}
                          className={m === "accept" ? SM_ON : SM}
                          disabled={busy}
                          onClick={() => mark(card.id, "accept")}
                        >
                          {m === "accept" ? "Aceptada" : "Aceptar"}
                        </button>
                        <button
                          type="button"
                          aria-pressed={m === "discard"}
                          className={m === "discard" ? SM_ON : SM}
                          disabled={busy}
                          onClick={() => mark(card.id, "discard")}
                        >
                          {m === "discard" ? "Descartada" : "Descartar"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {cards.length > 0 ? (
          <button
            type="button"
            data-testid="profile-cards-save"
            className={PRIMARY}
            disabled={busy || decided.length === 0}
            onClick={() => void save()}
          >
            {busy ? "Guardando…" : "Guardar lo que elegí"}
          </button>
        ) : null}
        <Link href={next} className={SECONDARY} data-testid="profile-cards-next">
          {pending === 0 ? "Seguir" : "Seguir sin revisar el resto"}
        </Link>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-fg">
      {label}
      {children}
    </label>
  );
}

/** Los campos editables de una tarjeta, según su tipo. */
function CardFields({
  card,
  disabled,
  onChange,
}: {
  card: ProfileReadCard;
  disabled: boolean;
  onChange: (change: Record<string, unknown>) => void;
}) {
  const text = (v: string): string | null => (v === "" ? null : v);
  switch (card.kind) {
    case "experience":
    case "education": {
      const isExp = card.kind === "experience";
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label={isExp ? "Empresa" : "Institución"}>
            <input
              className={FIELD}
              disabled={disabled}
              maxLength={120}
              value={card.kind === "experience" ? card.organization : card.institution}
              onChange={(e) =>
                onChange(isExp ? { organization: e.target.value } : { institution: e.target.value })
              }
            />
          </Labeled>
          <Labeled label={isExp ? "Cargo" : "Título"}>
            <input
              className={FIELD}
              disabled={disabled}
              maxLength={120}
              value={card.title}
              onChange={(e) => onChange({ title: e.target.value })}
            />
          </Labeled>
          <Labeled label="Desde">
            <input
              type="month"
              className={FIELD}
              disabled={disabled}
              value={card.startMonth ?? ""}
              onChange={(e) => onChange({ startMonth: text(e.target.value) })}
            />
          </Labeled>
          <Labeled label="Hasta">
            <input
              type="month"
              className={FIELD}
              disabled={disabled || (card.kind === "experience" && card.isCurrent)}
              value={card.endMonth ?? ""}
              onChange={(e) => onChange({ endMonth: text(e.target.value) })}
            />
          </Labeled>
          {card.kind === "experience" ? (
            <label className="flex min-h-11 items-center gap-2 text-sm text-fg sm:col-span-2">
              <input
                type="checkbox"
                disabled={disabled}
                checked={card.isCurrent}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? { isCurrent: true, endMonth: null } : { isCurrent: false },
                  )
                }
              />
              Sigo en este trabajo
            </label>
          ) : null}
        </div>
      );
    }
    case "skill":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Skill">
            <input
              className={FIELD}
              // Las de la lista se identifican por su slug: el nombre no se edita
              disabled={disabled || card.slug !== null}
              maxLength={40}
              value={card.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </Labeled>
          <Labeled label="Tu nivel">
            <select
              className={FIELD}
              disabled={disabled}
              value={card.level ?? ""}
              onChange={(e) =>
                onChange({ level: e.target.value === "" ? null : Number(e.target.value) })
              }
            >
              <option value="">Elegí un nivel</option>
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Labeled>
          <p className="text-xs text-fg-muted sm:col-span-2">
            {card.verified
              ? "Aparece en tu CV."
              : "No la encontramos escrita en tu CV: aceptala solo si la usás."}
          </p>
        </div>
      );
    case "language":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Idioma">
            <input
              className={FIELD}
              disabled={disabled}
              maxLength={40}
              value={card.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </Labeled>
          <Labeled label="Nivel">
            <input
              className={FIELD}
              disabled={disabled}
              maxLength={30}
              placeholder="Por ejemplo C1"
              value={card.level ?? ""}
              onChange={(e) => onChange({ level: text(e.target.value) })}
            />
          </Labeled>
        </div>
      );
  }
}
