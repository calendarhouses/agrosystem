import type { Metadata } from "next";

import { ActivityJournalPanel } from "@/components/dashboard/activity-journal-panel";

export const metadata: Metadata = {
  title: "Журнал",
};

export const dynamic = "force-dynamic";

export default function JournalPage() {
  return <ActivityJournalPanel />;
}
