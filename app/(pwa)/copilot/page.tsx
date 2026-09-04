import { redirect } from "next/navigation";

import { LevadaCopilotFullscreen } from "@/components/ai/LevadaCopilotDrawer";
import { getCurrentActor } from "@/lib/app-actor";
import { canAccessLevadius } from "@/lib/levadius-access";

export default async function CopilotPage() {
  const actor = await getCurrentActor();
  if (!canAccessLevadius(actor)) {
    redirect("/");
  }
  return <LevadaCopilotFullscreen />;
}
