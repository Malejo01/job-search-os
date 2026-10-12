/**
 * Quita emails y teléfonos de un texto antes de guardarlo en el pool (ADR-014, ley 25.326): el
 * evaluador no los necesita y no hay motivo para conservarlos. Función pura.
 */
const CONTACT = "[contacto]";

const EMAIL = /(?:mailto:)?[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

// Candidato a teléfono: dígitos con espacios, guiones, puntos y paréntesis, `+` opcional.
// Solo espacios y tabulaciones (no saltos de línea) para no pegar números de líneas distintas.
const PHONE_CANDIDATE = /(?:tel:)?(?<![\w+.-])\+?\(?\d[\d \t().-]*\d(?!\w)/gi;

const MIN_PHONE_DIGITS = 8;

const digitCount = (s: string) => (s.match(/\d/g) ?? []).length;

function isYear(group: string): boolean {
  return /^(?:19|20)\d{2}$/.test(group);
}

/** Lo que tiene 8 o más dígitos pero no es un teléfono: años, fechas, horas, versiones, IPs. */
function looksLikeNonPhone(match: string): boolean {
  const groups = match.match(/\d+/g) ?? [];
  // Años sueltos o rangos de años ("2020-2024", "2018 2020 2022")
  if (groups.every((g) => g.length === 4 && isYear(g))) return true;
  // Fecha ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(match)) return true;
  // Rango de horas ("10.30 - 18.30")
  if (/^\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}$/.test(match)) return true;
  // Versiones e IPs: grupos cortos separados solo por puntos, sin espacios ni "+"
  if (/^\d{1,3}(?:\.\d{1,3}){2,}$/.test(match)) return true;
  // Rangos de montos con grupos de miles ("3.000 - 4.500")
  if (/^\d{1,3}(?:\.\d{3})*\s*[-–]\s*\d{1,3}(?:\.\d{3})*$/.test(match)) return true;
  // Rango de dos montos de 3 a 6 dígitos con guion ("3000-4000", "80000 - 100000", "100 000 - 120 000")
  const parts = match.split(/\s*-\s*/);
  if (parts.length === 2 && parts.every(isAmount)) return true;
  return false;
}

/** Un número de 3 a 6 dígitos, con miles agrupados por espacio o punto ("100 000"). */
function isAmount(part: string): boolean {
  return /^\d{1,6}(?:[ .]\d{3})*$/.test(part) && digitCount(part) >= 3 && digitCount(part) <= 6;
}

export function stripContacts(text: string): string {
  return text.replace(EMAIL, CONTACT).replace(PHONE_CANDIDATE, (match) => {
    const bare = match.replace(/^tel:/i, "");
    if (digitCount(bare) < MIN_PHONE_DIGITS || looksLikeNonPhone(bare)) return match;
    return CONTACT;
  });
}
