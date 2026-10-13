import { getCurrentUser } from "@/lib/auth";
import FeedbackThread from "./FeedbackThread";

export default async function FeedbackThreadPage({ params }: PageProps<"/feedback/[id]">) {
  const user = await getCurrentUser();
  const { id } = await params;
  return <FeedbackThread id={Number(id)} isAdmin={user?.role === "admin"} />;
}
