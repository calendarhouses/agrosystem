/** Українські форми множини: 1 / 2–4 / 5+ (з винятком 11–14). */
export function ukPlural(
  n: number,
  one: string,
  few: string,
  many: string
): string {
  const abs = Math.abs(Math.trunc(n)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function ukStationLabel(n: number): string {
  return `${n} ${ukPlural(n, "станція", "станції", "станцій")}`;
}

export function ukFieldLabel(n: number): string {
  return `${n} ${ukPlural(n, "поле", "поля", "полів")}`;
}
