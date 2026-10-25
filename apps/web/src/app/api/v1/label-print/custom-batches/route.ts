import { requireUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { handle, HttpError, ok, readJson, str } from "@/lib/http";
import { requireLabelPrinting } from "@/lib/label-print";
import { customTextSheets, deleteCustomBatch, listCustomBatches, parseAndSaveCustomCsv, parseCustomImportOptions, prepareCustomImport, readCustomImport, saveCustomImport } from "@/lib/label-custom-csv";

export const GET = handle(async () => {
  const user = requireLabelPrinting(await requireUser());
  const batches = await listCustomBatches(query, user);
  return ok({ batches });
});

export const POST = handle(async (req: Request) => {
  const user = requireLabelPrinting(await requireUser());
  if (req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    let form: FormData;
    try { form = await req.formData(); }
    catch { throw new HttpError(400, "上传表单格式不正确"); }
    const file = form.get("file");
    const text = typeof form.get("text") === "string" ? String(form.get("text")) : "";
    const hasFile = file instanceof File && file.size > 0;
    if (hasFile && text.trim()) throw new HttpError(400, "文件和粘贴文本请选择一种");
    if (!hasFile && !text.trim()) throw new HttpError(400, "请选择文件或粘贴表格文本");
    if (hasFile && !/\.(xlsx|csv|tsv|txt)$/i.test(file.name)) throw new HttpError(400, "只支持 .xlsx、.csv、.tsv 或 .txt 文件");
    if ((hasFile ? file.size : new TextEncoder().encode(text).byteLength) > 20 * 1024 * 1024) throw new HttpError(413, "文件或文本不能超过 20 MB");
    const mode = str(form.get("mode")) || "preview";
    if (mode !== "preview" && mode !== "commit") throw new HttpError(400, "导入模式无效");
    let rawOptions: unknown;
    try { rawOptions = JSON.parse(str(form.get("options")) || "{}"); }
    catch { throw new HttpError(400, "导入选项不是有效 JSON"); }
    const options = parseCustomImportOptions(rawOptions);
    let sheets;
    try {
      sheets = hasFile ? await readCustomImport(await file.arrayBuffer(), file.name) : customTextSheets(text, "粘贴", true);
    } catch { throw new HttpError(400, "无法读取该文件，请检查文件内容与格式"); }
    const parsed = prepareCustomImport(sheets, options);
    if (mode === "preview") return ok(parsed.preview);
    const defaultName = hasFile
      ? file.name.replace(/\.[^.]+$/, "") + (sheets.length > 1 ? `-${parsed.preview.sheet}` : "")
      : `粘贴-${new Date().toISOString().slice(0, 10)}`;
    const batch = await withTransaction((client) => saveCustomImport(client, user, str(form.get("batch_name")) || defaultName, parsed));
    return ok({ batch }, 201);
  }
  const body = await readJson(req);
  const csvText = str(body.csv_text);
  if (!csvText) throw new HttpError(400, "请提供 CSV 文件内容");
  const batchName = str(body.batch_name) || "自定义批次";

  const batch = await withTransaction(async (client) => {
    return parseAndSaveCustomCsv(client, user, batchName, csvText);
  });

  return ok({ batch }, 201);
});

export const DELETE = handle(async (req: Request) => {
  const user = requireLabelPrinting(await requireUser());
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "缺少有效批次 id");
  await deleteCustomBatch(query, id, user);
  return ok({ message: "批次已删除" });
});
