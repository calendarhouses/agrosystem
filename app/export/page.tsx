import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Застарілий шлях — увесь hub тепер на /accounting */
export default function ExportPageRedirect() {
  redirect("/accounting");
}
