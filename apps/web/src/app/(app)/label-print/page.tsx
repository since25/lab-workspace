import { requireUser } from "@/lib/auth";
import { notFound } from "next/navigation";
import LabelPrintClient from "./LabelPrintClient";

export default async function LabelPrintPage() {
  const user = await requireUser();
  if (!user.label_print_enabled) notFound();
  return <LabelPrintClient isAdmin={user.role === "admin"} />;
}
