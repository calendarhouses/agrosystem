import { redirect } from "next/navigation";

/** Колишній Агроплан — перенаправлення на Операційну хронологію */
export default function CalendarPage() {
  redirect("/operations");
}
