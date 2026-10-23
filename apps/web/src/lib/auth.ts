import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { query } from "./db";
import { HttpError } from "./http";

export type Role = "admin" | "member";
export interface SessionUser {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  // 「冰箱总览」附加权限：可只读查看全部人员的冰箱内容
  freezer_view_all: boolean;
  tenant_id: number;
  tenant_name: string;
  label_print_enabled: boolean;
}

// 管理员或开启了「冰箱总览」的成员可只读查看全部人员的冰箱内容
export const canViewAllFreezer = (u: SessionUser) => u.role === "admin" || u.freezer_view_all;

export const SESSION_COOKIE = "lab_session";
const SESSION_DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

let dummyHash: Promise<string> | undefined;

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

export function validatePassword(pw: string): string | null {
  return pw.length >= 8 ? null : "密码至少 8 位";
}

// 校验用户名密码；连续失败 5 次锁定 15 分钟
export async function verifyLogin(username: string, password: string): Promise<SessionUser> {
  const rows = await query<SessionUser & { password_hash: string; is_active: boolean; failed_attempts: number; locked_until: Date | null }>(
    `SELECT u.id, u.username, u.display_name, u.role, u.freezer_view_all, u.password_hash, u.is_active,
            u.failed_attempts, u.locked_until, u.tenant_id, t.name AS tenant_name,
            t.label_print_enabled
       FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.username = $1 AND t.is_active`,
    [username]
  );
  const u = rows[0];
  if (!u || !u.is_active) {
    // 用户不存在时也做一次哈希，避免通过耗时判断账号是否存在
    dummyHash ??= bcrypt.hash("dummy-password", 12);
    await bcrypt.compare(password, await dummyHash);
    throw new HttpError(401, "用户名或密码错误");
  }
  if (u.locked_until && u.locked_until > new Date()) {
    throw new HttpError(423, "密码错误次数过多，账号已临时锁定，请 15 分钟后再试或联系管理员");
  }
  if (!(await bcrypt.compare(password, u.password_hash))) {
    const failed = u.failed_attempts + 1;
    const lock = failed >= MAX_FAILED;
    await query(
      `UPDATE users SET failed_attempts = $2,
         locked_until = CASE WHEN $3 THEN now() + interval '${LOCK_MINUTES} minutes' ELSE locked_until END
       WHERE id = $1`,
      [u.id, lock ? 0 : failed, lock]
    );
    throw new HttpError(401, "用户名或密码错误");
  }
  await query("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1", [u.id]);
  return { id: u.id, username: u.username, display_name: u.display_name, role: u.role, freezer_view_all: u.freezer_view_all,
    tenant_id: u.tenant_id, tenant_name: u.tenant_name, label_print_enabled: u.label_print_enabled };
}

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await query("INSERT INTO sessions(id, user_id, expires_at) VALUES ($1,$2,$3)", [tokenHash(token), userId, expires]);
  await query("DELETE FROM sessions WHERE expires_at < now()");
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // 内网 http 部署时为 false；上 HTTPS 后在环境变量里打开
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await query("DELETE FROM sessions WHERE id = $1", [tokenHash(token)]);
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await query<SessionUser>(
    `SELECT u.id, u.username, u.display_name, u.role, u.freezer_view_all, u.tenant_id,
            t.name AS tenant_name, t.label_print_enabled
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN tenants t ON t.id = u.tenant_id
       WHERE s.id = $1 AND s.expires_at > now() AND u.is_active AND t.is_active`,
    [tokenHash(token)]
  );
  return rows[0] ?? null;
}

export async function requireUser(role?: Role): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new HttpError(401, "请先登录");
  if (role === "admin" && u.role !== "admin") throw new HttpError(403, "需要管理员权限");
  return u;
}
