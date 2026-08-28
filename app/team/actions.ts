"use server";

import { listActivityLog, type ActivityLogRow } from "@/lib/activity-log";
import { getCurrentActor, type AppActor } from "@/lib/app-actor";

export async function getMyProfileAction(): Promise<AppActor | null> {
  const actor = await getCurrentActor();
  if (!actor.id) return null;
  return actor;
}

export async function listRecentActivityAction(input?: {
  limit?: number;
}): Promise<ActivityLogRow[]> {
  return listActivityLog({ limit: input?.limit ?? 60 });
}
