import { audit } from "@/lib/audit";
import { createSession, verifyLogin } from "@/lib/auth";
import { HttpError, handle, ok, readJson, str } from "@/lib/http";

export const POST = handle(async (req: Request) => {
  const body = await readJson(req);
  const username = str(body.username);
  const password = String(body.password ?? "");
  if (!username || !password) throw new HttpError(400, "请输入用户名和密码");
  try {
    const user = await verifyLogin(username, password);
    await createSession(user.id);
    await audit(user.id, "auth.login", "user", user.id, {}, req);
    return ok({ user });
  } catch (e) {
    if (e instanceof HttpError) await audit(null, "auth.login_failed", "user", "", { username, status: e.status }, req);
    throw e;
  }
});
