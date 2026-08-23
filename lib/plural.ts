/** Українська плюралізація: 1 подія · 2–4 події · 5+ подій (з урахуванням 11–14). */
export function getPlural(
  count: number,
  forms: [string, string, string]
): string {
  const abs = Math.abs(Math.trunc(count));
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return forms[1];
  }
  return forms[2];
}

export function formatCountPlural(
  count: number,
  forms: [string, string, string]
): string {
  return `${count} ${getPlural(count, forms)}`;
}
