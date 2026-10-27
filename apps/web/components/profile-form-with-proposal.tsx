"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { ProposalLoadedNotice } from "./assistant-proposal-loader";
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

/** Valores del formulario con los de la propuesta encima (las casillas llegan como "on" / ""). */
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

/**
 * «Tu perfil» con la propuesta del asistente (AG-3). El formulario tiene campos con estado propio
 * (modalidades, buscador de país), así que en vez de tocar el DOM se lo vuelve a montar con
 * `initial` = lo que ya tenía cargado + la propuesta (lo que la persona tipeó sin guardar se pierde).
 * Nada se guarda hasta que la persona toca Guardar.
 */
export function ProfileFormWithProposal(props: Props & { initial: ProfileFormValues }) {
  const [state, setState] = useState<{
    initial: ProfileFormValues;
    proposal: StoredProposal | null;
    key: number;
  }>({ initial: props.initial, proposal: null, key: 0 });

  useEffect(() => {
    const load = () => {
      const proposal = takeProposal("profile");
      if (!proposal) return;
      setState((prev) => ({
        initial: mergeProfileValues(prev.initial, proposal.formValues),
        proposal,
        key: prev.key + 1,
      }));
    };
    load();
    window.addEventListener(PROPOSAL_EVENT, load);
    return () => window.removeEventListener(PROPOSAL_EVENT, load);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {state.proposal ? <ProposalLoadedNotice proposal={state.proposal} /> : null}
      <ProfileForm key={state.key} {...props} initial={state.initial} />
    </div>
  );
}
