"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ProposalLoadedNotice, useClearOnSubmit } from "./assistant-proposal-loader";
import { PROPOSAL_EVENT, takeProposal, type StoredProposal } from "./assistant-proposal";
import { ProfileForm } from "./profile-form";
import type { ProfileFormValues } from "@/lib/onboarding";

type Props = ComponentProps<typeof ProfileForm>;

const text = (v: string | string[] | undefined, fallback: string): string =>
  typeof v === "string" ? v : fallback;
const list = (v: string | string[] | undefined, fallback: string[]): string[] =>
  Array.isArray(v) ? v : fallback;
const flag = (v: string | string[] | undefined, fallback: boolean): boolean =>
  typeof v === "string" ? v === "on" : fallback;

/** Valores con los de la propuesta encima (las casillas llegan como "on" / ""). */
export function mergeProfileValues(
  base: ProfileFormValues,
  values: Record<string, string | string[]>,
): ProfileFormValues {
  const lang = values.jobLanguage;
  return {
    country: text(values.country, base.country),
    city: text(values.city, base.city),
    acceptedModalities: list(values.acceptedModalities, base.acceptedModalities),
    jobLanguage: lang === "es" || lang === "en" || lang === "both" ? lang : base.jobLanguage,
    workAuthUs: flag(values.workAuthUs, base.workAuthUs),
    workAuthEu: flag(values.workAuthEu, base.workAuthEu),
    workAuthOther: list(values.workAuthOther, base.workAuthOther),
    englishCefr: text(values.englishCefr, base.englishCefr),
    yearsTotal: text(values.yearsTotal, base.yearsTotal),
    summary: text(values.summary, base.summary),
  };
}

/** Lo que el formulario montado tiene ahora (con lo que la persona tipeó y no guardó). */
function currentFormValues(form: HTMLFormElement, fallback: ProfileFormValues): ProfileFormValues {
  const data = new FormData(form);
  const str = (k: string) => {
    const v = data.get(k);
    return typeof v === "string" ? v : null;
  };
  const all = (k: string) => data.getAll(k).filter((v): v is string => typeof v === "string");
  const lang = str("jobLanguage");
  return {
    country: all("country")[0] ?? "",
    city: str("city") ?? fallback.city,
    acceptedModalities: all("acceptedModalities"),
    jobLanguage: lang === "es" || lang === "en" || lang === "both" ? lang : fallback.jobLanguage,
    workAuthUs: str("workAuthUs") === "on",
    workAuthEu: str("workAuthEu") === "on",
    workAuthOther: all("workAuthOther"),
    englishCefr: str("englishCefr") ?? fallback.englishCefr,
    yearsTotal: str("yearsTotal") ?? fallback.yearsTotal,
    summary: str("summary") ?? fallback.summary,
  };
}

const same = (a: ProfileFormValues, b: ProfileFormValues): boolean =>
  JSON.stringify({
    ...a,
    acceptedModalities: [...a.acceptedModalities].sort(),
    workAuthOther: [...a.workAuthOther].sort(),
  }) ===
  JSON.stringify({
    ...b,
    acceptedModalities: [...b.acceptedModalities].sort(),
    workAuthOther: [...b.workAuthOther].sort(),
  });

/**
 * «Tu perfil» con la propuesta del asistente (AG-3). El formulario tiene campos con estado propio
 * (modalidades, buscador de país), así que en vez de tocar el DOM se lo vuelve a montar con
 * `initial` = lo que el formulario tiene AHORA + los campos propuestos (nada más). Si la persona
 * tenía cambios sin guardar, se le pregunta antes. Nada se guarda hasta que toca Guardar.
 */
export function ProfileFormWithProposal(props: Props & { initial: ProfileFormValues }) {
  const ref = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  // Lo guardado más reciente (la página lo actualiza después de Guardar)
  const savedRef = useRef(props.initial);
  useEffect(() => {
    savedRef.current = props.initial;
  }, [props.initial]);
  const [state, setState] = useState<{
    initial: ProfileFormValues;
    proposal: StoredProposal | null;
    key: number;
  }>({ initial: props.initial, proposal: null, key: 0 });
  const [showNotice, setShowNotice] = useState(false);

  useEffect(() => {
    const load = () => {
      const proposal = takeProposal("profile");
      if (!proposal) return;
      const saved = savedRef.current;
      const form = ref.current?.querySelector("form");
      const current = form ? currentFormValues(form, saved) : saved;
      if (
        !same(current, saved) &&
        !window.confirm("Tenés cambios sin guardar en este formulario. ¿Cargar la propuesta igual?")
      ) {
        return;
      }
      setState((prev) => ({
        initial: mergeProfileValues(current, proposal.formValues),
        proposal,
        key: prev.key + 1,
      }));
      setShowNotice(true);
      requestAnimationFrame(() => noticeRef.current?.focus());
    };
    load();
    window.addEventListener(PROPOSAL_EVENT, load);
    return () => window.removeEventListener(PROPOSAL_EVENT, load);
  }, []);

  useClearOnSubmit(ref, showNotice, () => setShowNotice(false));

  return (
    <div ref={ref} className="flex flex-col gap-3">
      <ProposalLoadedNotice proposal={showNotice ? state.proposal : null} noticeRef={noticeRef} />
      <ProfileForm
        key={state.key}
        {...props}
        initial={state.key === 0 ? props.initial : state.initial}
      />
    </div>
  );
}
