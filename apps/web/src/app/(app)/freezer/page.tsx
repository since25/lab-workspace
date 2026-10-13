import { canViewAllFreezer, getCurrentUser } from "@/lib/auth";
import FreezerClient from "./FreezerClient";

export default async function FreezerPage() {
  const user = await getCurrentUser();
  return <FreezerClient userId={user?.id ?? 0} isAdmin={user?.role === "admin"} canViewAll={!!user && canViewAllFreezer(user)} />;
}
