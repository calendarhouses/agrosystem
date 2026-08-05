import { redirect } from "next/navigation";

/** Старий шлях — редірект на головну карту */
export default function FieldsPage() {
  redirect("/");
}
