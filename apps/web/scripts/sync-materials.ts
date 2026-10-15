// 服务器本机任务使用已有 lab.env 连接数据库，不新增网络接口或工作台登录凭证。
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { parseEnv } from "node:util";
import pg from "pg";
import { readWorkbook } from "../src/lib/imports/sheet";
import { parseMaterialWorkbook } from "../src/lib/imports/materials";
import { importMaterialRows, MaterialError, validateMaterialKeys } from "../src/lib/materials-data";

let client: pg.Client | undefined;
let connected = false;
let stage = "input";
try {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--env" || args[2] !== "--file") throw new Error();
  const env = parseEnv(await readFile(args[1], "utf8"));
  if (!env.DATABASE_URL || !/\.(xlsx|csv)$/i.test(args[3]) || (await stat(args[3])).size > 20 * 1024 * 1024) throw new Error();
  const buf = Uint8Array.from(await readFile(args[3])).buffer;
  const parsed = parseMaterialWorkbook(await readWorkbook(buf, basename(args[3])));
  if (parsed.fatal || parsed.issues.length) throw new MaterialError("导出文件不完整");
  validateMaterialKeys(parsed.rows);
  stage = "database";
  client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  connected = true;
  await client.query("BEGIN");
  stage = "import";
  const result = await importMaterialRows(client, parsed.rows, basename(args[3]), null);
  await client.query("COMMIT");
  console.log(JSON.stringify({ status: "success", total: parsed.rows.length, ...result }));
} catch (error) {
  if (connected) await client?.query("ROLLBACK").catch(() => {});
  console.error(JSON.stringify({ status: "failed", stage, code: error instanceof MaterialError ? "INVALID_PURCHASE_RECORDS" : "IMPORT_FAILED" }));
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
