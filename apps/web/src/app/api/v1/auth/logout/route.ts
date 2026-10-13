import { destroySession } from "@/lib/auth";
import { handle, ok } from "@/lib/http";

export const POST = handle(async () => {
  await destroySession();
  return ok({ ok: true });
});
