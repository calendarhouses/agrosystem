import { redirect } from "next/navigation";

/** Mock-звіти v1 — перенаправляємо на головну до реалізації. */
export default function ReportsPage() {
  redirect("/");
}
