/** Une clases ignorando las vacías. Sin tailwind-merge: dos clases que se pisan no se resuelven. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
