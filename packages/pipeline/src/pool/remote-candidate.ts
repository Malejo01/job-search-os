import { foldText } from "../normalize/text";

/**
 * Filtro previo del pool para los ATS públicos (ronda 47): sin LLM y sin base. Un ATS publica todos
 * los puestos de la empresa, también los presenciales; al pool solo entra lo que puede ser remoto.
 * Ante la duda (ubicación vacía) se guarda: el prefiltro por usuario decide. "Remote - US only"
 * también pasa: restringir el país es trabajo del prefiltro por usuario, no de acá.
 */
export type PoolRemoteInput = {
  locationText?: string | null;
  /** `workplaceType` del proveedor (Ashby: Remote | Hybrid | OnSite; Lever: remote | hybrid | on-site). */
  workplaceType?: string | null;
  isRemote?: boolean | null;
};

const NOT_REMOTE = /\b(hybrid|hibrido|on[ -]?site|onsite|presencial|in[ -]office)\b/;
const REMOTE_TEXT =
  /\b(remote|remoto|remota|remotely|distributed|home[- ]?based|work from home|wfh|telecommut\w*|teletrabajo|global|americas|latam|latin america|latinoamerica|argentina|anywhere|worldwide)\b/;

function clean(value: string | null | undefined): string {
  return foldText(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPoolRemoteCandidate(input: PoolRemoteInput): boolean {
  const workplace = clean(input.workplaceType);
  const location = clean(input.locationText);

  // Un modo explícito del proveedor manda sobre el texto libre.
  if (workplace) {
    if (NOT_REMOTE.test(workplace)) return false;
    if (REMOTE_TEXT.test(workplace)) return true;
  }
  if (input.isRemote === true) return true;
  if (input.isRemote === false && !location) return false;

  if (!location) return true;
  if (NOT_REMOTE.test(location)) return false;
  return REMOTE_TEXT.test(location);
}
