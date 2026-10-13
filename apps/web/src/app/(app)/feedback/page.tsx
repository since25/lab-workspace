import { getCurrentUser } from "@/lib/auth";
import FeedbackList from "./FeedbackList";

export default async function FeedbackPage() {
  const user = await getCurrentUser();
  return <FeedbackList isAdmin={user?.role === "admin"} />;
}
