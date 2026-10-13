import { requireUser } from "@/lib/auth";
import { handle, ok } from "@/lib/http";

export const GET = handle(async () => ok({ user: await requireUser() }));
