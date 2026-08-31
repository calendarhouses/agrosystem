import type { NextRequest } from "next/server";

/**
 * Захист cron-ендпоінтів для Vercel Cron, cron-job.org та ручного запуску.
 *
 * Підтримує:
 *   Authorization: Bearer $CRON_SECRET
 *   ?secret=$CRON_SECRET  (зручно для cron-job.org без custom headers)
 */
export function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("[cron] CRON_SECRET не задано");
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;

  const querySecret = new URL(request.url).searchParams.get("secret")?.trim();
  return querySecret === secret;
}
