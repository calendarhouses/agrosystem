import { redirect } from "next/navigation";

type FieldsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/** Старий шлях — редірект на головну карту з збереженням поля */
export default async function FieldsPage({ searchParams }: FieldsPageProps) {
  const params = (await searchParams) ?? {};
  const raw = params.field ?? params.fieldId ?? params.id;
  const field = Array.isArray(raw) ? raw[0] : raw;
  if (typeof field === "string" && field.trim()) {
    redirect(`/?field=${encodeURIComponent(field.trim())}`);
  }
  redirect("/");
}
