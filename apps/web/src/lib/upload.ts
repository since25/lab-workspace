import { HttpError } from "./http";

const MAX_IMPORT_MB = 20;

// 读取导入表单里的文件：限制大小和扩展名
export async function readImportFile(req: Request): Promise<{ name: string; buf: ArrayBuffer; mode: string }> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "请选择要导入的文件");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "请选择要导入的文件");
  if (!/\.(xlsx|csv)$/i.test(file.name)) throw new HttpError(400, "只支持 .xlsx 或 .csv 文件");
  if (file.size > MAX_IMPORT_MB * 1024 * 1024) throw new HttpError(413, `文件不能超过 ${MAX_IMPORT_MB} MB`);
  return { name: file.name, buf: await file.arrayBuffer(), mode: String(form.get("mode") ?? "preview") };
}
