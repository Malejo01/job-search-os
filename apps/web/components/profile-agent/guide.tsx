"use client";

import {
  GUIDE_CARD_NOTES,
  GUIDE_CARD_TITLES,
  GUIDE_DISCLAIMER,
  GUIDE_MODALITY_LABELS,
  GUIDE_PORTAL_NAMES,
  GUIDE_SENIORITY_OPTIONS,
  ISO_COUNTRY_CODES,
  MODALITIES,
  PROFILE_AGENT_API,
  PROFILE_AGENT_STORAGE_KEYS,
  initialProfileAgentState,
  parseProfileAgentState,
  profileAgentPath,
  reinforceEvidenceText,
  searchUrlFor,
  type ProfileAgentBase,
  type ProfileGuideAnswers,
  type ProfileGuideCard,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, buttonClasses, cardClasses, inputClasses } from "@/components/ui";

/**
 * Guía de búsqueda del agente de perfil (ADR-034, R10-4). Una pregunta por vez, con opciones y copy fijo: no
 * hay modelo. Al final propone tarjetas (puestos, criterios, palabras de alerta, skills a reforzar) y solo se
 * guarda lo que la persona confirma. Las respuestas viven en `sessionStorage` (`state.guide`): si el onboarding
 * no está completo, criterios y país no se escriben y precargan el formulario. Sin secretos acá.
 */
type Step = { step: string; title: string; question: string; help: string };
type Opt = { value: string; label: string };
type View = {
  step: Step | null;
  left: number;
  complete: boolean;
  roleOptions: Opt[];
  defaults: { roles: string[]; country: string | null };
  cards: ProfileGuideCard[] | null;
  roleLabels: Record<string, string>;
  forwardLinks: { app: string; onboarding: string };
};
type ApiErr = { ok: false; error: string; message: string };
type Decision = "pending" | "saved" | "deferred" | "discarded" | "done";

const PRIMARY = buttonClasses();
const SECONDARY = buttonClasses({ variant: "secondary" });
const FIELD = inputClasses();
const TEXTAREA = inputClasses({ multiline: true });
const PANEL = cardClasses({ padding: "none", className: "flex flex-col gap-3 p-4 sm:p-5" });

async function post(
  body: Record<string, unknown>,
): Promise<(View & { ok: true; guide: ProfileGuideAnswers }) | ApiErr> {
  try {
    const res = await fetch(PROFILE_AGENT_API.guide, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as never;
  } catch {
    return { ok: false, error: "network", message: "No hay conexión. Probá de nuevo." };
  }
}

function readGuide(): ProfileGuideAnswers {
  try {
    const raw = window.sessionStorage.getItem(PROFILE_AGENT_STORAGE_KEYS.state);
    return (raw ? parseProfileAgentState(JSON.parse(raw)) : null)?.guide ?? {};
  } catch {
    return {};
  }
}

function writeGuide(guide: ProfileGuideAnswers): void {
  try {
    const raw = window.sessionStorage.getItem(PROFILE_AGENT_STORAGE_KEYS.state);
    let current = null;
    try {
      current = raw ? parseProfileAgentState(JSON.parse(raw)) : null;
    } catch {
      current = null;
    }
    const next = { ...(current ?? initialProfileAgentState()), stage: "guide" as const, guide };
    window.sessionStorage.setItem(PROFILE_AGENT_STORAGE_KEYS.state, JSON.stringify(next));
  } catch {
    // sin almacenamiento de sesión: la guía sigue en memoria
  }
}

const countryName = (code: string): string => {
  try {
    return new Intl.DisplayNames(["es"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

export function ProfileGuide({ base }: { base: ProfileAgentBase }) {
  const [view, setView] = useState<View | null>(null);
  const [guide, setGuide] = useState<ProfileGuideAnswers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const started = useRef(false);

  // campos del paso
  const [picked, setPicked] = useState<string[]>([]);
  const [country, setCountry] = useState("");
  const [years, setYears] = useState<number | null>(null);
  const [salary, setSalary] = useState("");
  const [avoid, setAvoid] = useState("");

  const apply = useCallback((r: View & { guide: ProfileGuideAnswers }) => {
    setView(r);
    setGuide(r.guide);
    writeGuide(r.guide);
    setPicked([]);
    setYears(null);
    setSalary("");
    setAvoid("");
    if (r.defaults.country) setCountry((c) => c || r.defaults.country || "");
    if (r.cards) setDecisions(r.cards.map(() => "pending"));
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const r = await post({ action: "next", guide: readGuide() });
      if (r.ok) apply(r);
      else setError(r.message);
    })();
  }, [apply]);

  const focusKey = view ? (view.step?.step ?? "cards") : "loading";
  useEffect(() => {
    headingRef.current?.focus();
  }, [focusKey]);

  async function answer(input: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await post({ action: "answer", guide, input });
    setBusy(false);
    if (r.ok) apply(r);
    else setError(r.message);
  }

  async function decide(i: number, card: ProfileGuideCard, accept: boolean) {
    if (busy) return;
    if (!accept) return setDecisions((d) => d.map((x, j) => (j === i ? "discarded" : x)));
    // Las palabras de alerta no se guardan: es una guía para crear la alerta en el portal
    if (card.kind === "alert_keywords") {
      return setDecisions((d) => d.map((x, j) => (j === i ? "done" : x)));
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(PROFILE_AGENT_API.guide, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", card }),
      });
      const r = (await res.json()) as {
        ok: boolean;
        saved?: boolean;
        deferred?: boolean;
        message?: string;
      };
      if (!r.ok) {
        setError(r.message ?? "No pudimos guardar ese cambio.");
      } else {
        const next: Decision = r.deferred ? "deferred" : r.saved ? "saved" : "done";
        setDecisions((d) => d.map((x, j) => (j === i ? next : x)));
      }
    } catch {
      setError("No hay conexión. Probá de nuevo.");
    }
    setBusy(false);
  }

  const toggle = (value: string, max: number) =>
    setPicked((p) =>
      p.includes(value) ? p.filter((x) => x !== value) : p.length < max ? [...p, value] : p,
    );

  const alert = error ? (
    <Alert tone="danger" role="alert">
      <p>{error}</p>
    </Alert>
  ) : null;

  if (!view) {
    return error ? (
      alert
    ) : (
      <p role="status" className="text-sm text-fg-muted">
        Preparando la guía…
      </p>
    );
  }

  // ---- pasos ----
  if (view.step) {
    const s = view.step;
    const skip = (input: Record<string, unknown>) => (
      <button
        type="button"
        disabled={busy}
        onClick={() => void answer(input)}
        className={SECONDARY}
      >
        Saltear
      </button>
    );
    return (
      <section
        className="flex flex-col gap-3"
        aria-labelledby="guide-step"
        data-testid="guide-step"
      >
        <p className="text-sm text-fg-muted" data-testid="guide-progress">
          Quedan {view.left} {view.left === 1 ? "pregunta" : "preguntas"}
        </p>
        <h2
          id="guide-step"
          ref={headingRef}
          tabIndex={-1}
          className="text-heading font-bold text-fg"
        >
          {s.question}
        </h2>
        <p className="text-sm text-fg-muted">{s.help}</p>
        {alert}
        {s.step === "roles" ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Puestos</legend>
            {(view.roleOptions.length > 0 ? view.roleOptions : []).map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={picked.includes(o.value)}
                  onChange={() => toggle(o.value, 4)}
                />
                {o.label}
              </label>
            ))}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy || picked.length === 0}
                onClick={() => void answer({ step: "roles", roles: picked })}
                className={PRIMARY}
              >
                Continuar
              </button>
              {skip({ step: "roles", roles: [] })}
            </div>
          </fieldset>
        ) : null}
        {s.step === "modality" ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Modalidad</legend>
            {MODALITIES.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={picked.includes(m)} onChange={() => toggle(m, 3)} />
                {GUIDE_MODALITY_LABELS[m]}
              </label>
            ))}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy || picked.length === 0}
                onClick={() => void answer({ step: "modality", modalities: picked })}
                className={PRIMARY}
              >
                Continuar
              </button>
              {skip({ step: "modality", modalities: [] })}
            </div>
          </fieldset>
        ) : null}
        {s.step === "country" ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="guide-country" className="text-sm font-medium text-fg">
              País
            </label>
            <select
              id="guide-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className={FIELD}
            >
              <option value="">Elegí un país</option>
              {[...ISO_COUNTRY_CODES]
                .map((c) => ({ c, n: countryName(c) }))
                .sort((a, b) => a.n.localeCompare(b.n, "es"))
                .map(({ c, n }) => (
                  <option key={c} value={c}>
                    {n}
                  </option>
                ))}
            </select>
            <div>
              <button
                type="button"
                disabled={busy || country === ""}
                onClick={() => void answer({ step: "country", country })}
                className={PRIMARY}
              >
                Continuar
              </button>
            </div>
          </div>
        ) : null}
        {s.step === "seniority" ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Años de experiencia</legend>
            {GUIDE_SENIORITY_OPTIONS.map((o) => (
              <label key={o.years} className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="radio"
                  name="guide-years"
                  checked={years === o.years}
                  onChange={() => setYears(o.years)}
                />
                {o.label}
              </label>
            ))}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy || years === null}
                onClick={() => void answer({ step: "seniority", maxYearsHard: years })}
                className={PRIMARY}
              >
                Continuar
              </button>
              {skip({ step: "seniority", maxYearsHard: null })}
            </div>
          </fieldset>
        ) : null}
        {s.step === "salary" ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="guide-salary" className="text-sm font-medium text-fg">
              Mínimo mensual en dólares
            </label>
            <input
              id="guide-salary"
              inputMode="numeric"
              value={salary}
              onChange={(e) => setSalary(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
              className={FIELD}
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy || salary === ""}
                onClick={() =>
                  void answer({ step: "salary", salaryFloorUsdMonthly: Number(salary) })
                }
                className={PRIMARY}
              >
                Continuar
              </button>
              {skip({ step: "salary", salaryFloorUsdMonthly: null })}
            </div>
          </div>
        ) : null}
        {s.step === "avoid" ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="guide-avoid" className="text-sm font-medium text-fg">
              Palabras a evitar (una por línea)
            </label>
            <textarea
              id="guide-avoid"
              rows={4}
              value={avoid}
              onChange={(e) => setAvoid(e.target.value)}
              className={TEXTAREA}
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void answer({
                    step: "avoid",
                    avoid: avoid
                      .split("\n")
                      .map((l) => l.trim())
                      .filter((l) => l !== "")
                      .slice(0, 40),
                  })
                }
                className={PRIMARY}
              >
                Continuar
              </button>
              {skip({ step: "avoid", avoid: [] })}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  // ---- tarjetas ----
  const cards = view.cards ?? [];
  const forward = view.forwardLinks[base];
  return (
    <section
      className="flex flex-col gap-4"
      aria-labelledby="guide-cards"
      data-testid="guide-cards"
    >
      <h2
        id="guide-cards"
        ref={headingRef}
        tabIndex={-1}
        className="text-heading font-bold text-fg"
      >
        Lo que te propongo
      </h2>
      <p className="text-sm text-fg-muted">{GUIDE_DISCLAIMER}</p>
      {alert}
      {cards.length === 0 ? (
        <p className="text-sm text-fg-muted">No hay nada para proponerte con estas respuestas.</p>
      ) : null}
      {cards.map((card, i) => {
        const d = decisions[i] ?? "pending";
        return (
          <article key={i} className={PANEL} data-testid={`guide-card-${card.kind}`}>
            <h3 className="text-base font-bold text-fg">
              {GUIDE_CARD_TITLES[card.kind]}
              {card.kind === "alert_keywords" ? ` · ${GUIDE_PORTAL_NAMES[card.portal]}` : ""}
            </h3>
            <CardBody card={card} roleLabels={view.roleLabels} forward={forward} />
            <p className="text-sm text-fg-muted">{GUIDE_CARD_NOTES[card.kind]}</p>
            {d === "pending" ? (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(i, card, true)}
                  className={PRIMARY}
                >
                  {card.kind === "alert_keywords"
                    ? "Listo"
                    : card.kind === "reinforce"
                      ? "Sumar a mi plan"
                      : "Confirmar"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(i, card, false)}
                  className={SECONDARY}
                >
                  Descartar
                </button>
              </div>
            ) : (
              <p role="status" className="text-sm font-semibold text-fg">
                {d === "saved"
                  ? "Guardado."
                  : d === "deferred"
                    ? "Anotado: lo vas a ver cargado en el formulario de tu perfil."
                    : d === "discarded"
                      ? "Descartado."
                      : "Listo."}
              </p>
            )}
          </article>
        );
      })}
      <div className="flex flex-wrap gap-3">
        <Link href={profileAgentPath(base, "done")} className={PRIMARY}>
          Seguir al CV
        </Link>
      </div>
    </section>
  );
}

function CardBody({
  card,
  roleLabels,
  forward,
}: {
  card: ProfileGuideCard;
  roleLabels: Record<string, string>;
  forward: string;
}) {
  switch (card.kind) {
    case "roles":
      return (
        <ol className="list-decimal pl-5 text-sm text-fg">
          {card.roles.map((r) => (
            <li key={r}>{roleLabels[r] ?? r}</li>
          ))}
        </ol>
      );
    case "criteria":
      return (
        <ul className="flex flex-col gap-1 text-sm text-fg">
          {card.modalities ? (
            <li>Modalidad: {card.modalities.map((m) => GUIDE_MODALITY_LABELS[m]).join(", ")}</li>
          ) : null}
          {card.country ? <li>País: {countryName(card.country)}</li> : null}
          {card.maxYearsHard !== null ? (
            <li>Años de experiencia pedidos: hasta {card.maxYearsHard}</li>
          ) : null}
          {card.salaryFloorUsdMonthly !== null ? (
            <li>Mínimo mensual: USD {card.salaryFloorUsdMonthly}</li>
          ) : null}
          {card.titleBlocklistAdd.length > 0 ? (
            <li>Evitar títulos con: {card.titleBlocklistAdd.join(", ")}</li>
          ) : null}
        </ul>
      );
    case "alert_keywords": {
      const url = searchUrlFor(card.portal, card.keywords);
      return (
        <div className="flex flex-col gap-2 text-sm text-fg">
          <ul className="flex flex-wrap gap-2">
            {card.keywords.map((k) => (
              <li key={k} className="rounded-control bg-surface-muted px-2 py-1">
                {k}
              </li>
            ))}
          </ul>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                Abrir la búsqueda en {GUIDE_PORTAL_NAMES[card.portal]}
              </a>
            ) : null}
            <Link href={forward} className="font-semibold underline underline-offset-2">
              Cómo reenviar las alertas
            </Link>
          </p>
        </div>
      );
    }
    case "reinforce":
      return (
        <div className="text-sm text-fg">
          <p className="font-semibold">{card.name}</p>
          <p>{reinforceEvidenceText(card.evidence.offersAsking, card.evidence.poolSize)}</p>
        </div>
      );
  }
}
