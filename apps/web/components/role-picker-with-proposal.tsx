"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ProposalLoadedNotice, useClearOnSubmit } from "./assistant-proposal-loader";
import { PROPOSAL_EVENT, takeProposal, type StoredProposal } from "./assistant-proposal";
import { RolePicker } from "./role-picker";

type Props = ComponentProps<typeof RolePicker>;

/**
 * «Tus puestos» con la propuesta del asistente (AG-3). El selector es controlado y tiene tope, así
 * que en vez de simular clics se lo vuelve a montar con `selected` = los puestos propuestos. Lo que
 * la propuesta pide y el selector no muestra como casilla queda listado en el aviso. Nada se guarda
 * hasta que la persona toca «Guardar puestos».
 */
export function RolePickerWithProposal(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{
    selected: readonly string[];
    proposal: StoredProposal | null;
    missing: string[];
    key: number;
  }>({ selected: props.selected, proposal: null, missing: [], key: 0 });
  const [showNotice, setShowNotice] = useState(false);
  const available = props.groups.flatMap((g) => g.roles.map((r) => r.key));
  const availableKey = available.join(",");

  useEffect(() => {
    const keys = availableKey.split(",");
    const load = () => {
      const proposal = takeProposal("target_roles");
      const roles = proposal?.formValues.targetRoles;
      if (!proposal || !Array.isArray(roles)) return;
      const shown = roles.filter((r) => keys.includes(r));
      const missing = roles.filter((r) => !keys.includes(r));
      setState((prev) => ({ selected: shown, proposal, missing, key: prev.key + 1 }));
      setShowNotice(true);
      requestAnimationFrame(() => noticeRef.current?.focus());
    };
    load();
    window.addEventListener(PROPOSAL_EVENT, load);
    return () => window.removeEventListener(PROPOSAL_EVENT, load);
  }, [availableKey]);

  useClearOnSubmit(ref, showNotice, () => setShowNotice(false));

  return (
    <div ref={ref} className="flex flex-col gap-3">
      <ProposalLoadedNotice
        proposal={showNotice ? state.proposal : null}
        missing={state.missing}
        noticeRef={noticeRef}
      />
      <RolePicker key={state.key} {...props} selected={state.selected} />
    </div>
  );
}
