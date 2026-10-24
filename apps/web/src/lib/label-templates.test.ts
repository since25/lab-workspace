import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { labelRows } from "./label-sources";
import { listTemplates, parseTemplateDraft, resolveTemplate } from "./label-templates";
import type { MaterialQuery } from "./materials-list";

const db = new PGlite();
const query: MaterialQuery = async <T,>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows;
const draft = (changes: Record<string, unknown> = {}) => ({
  source: "materials", name: "示例大字模板", base_template: "name-detail", name_pt: 40, detail_pt: 16, line_gap: 6,
  fields: [{ key: "spec_model", prefix: "" }, { key: "item_name", prefix: "名称:" }, { key: "brand", prefix: "" }],
  ...changes,
});

// 全部迁移按序执行一遍，顺带验证 016 能接在现有结构之后
beforeAll(async () => {
  const dir = new URL("../../../../db/migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(file, dir), "utf8"));
  }
  await db.exec("INSERT INTO users(id,username,display_name,password_hash,role) VALUES (1,'example-admin','示例管理员','example-hash','admin')");
}, 60000);
afterAll(() => db.close());

describe("自定义模板校验", () => {
  it("保留字段顺序与前缀，丢弃未知与重复字段", () => {
    const t = parseTemplateDraft(draft({ fields: [{ key: "spec_model", prefix: "" }, { key: "nope", prefix: "x" }, { key: "spec_model", prefix: "重复" }, { key: "brand", prefix: "牌:" }] }));
    expect(t.fields).toEqual([{ key: "spec_model", prefix: "" }, { key: "brand", prefix: "牌:" }]);
    expect(t).toMatchObject({ source: "materials", base_template: "name-detail", name_pt: 40, detail_pt: 16, line_gap: 6 });
  });

  it("字号、行距越界或缺字段时报错", () => {
    expect(() => parseTemplateDraft(draft({ name_pt: 80 }))).toThrow("名称字号");
    expect(() => parseTemplateDraft(draft({ detail_pt: 9 }))).toThrow("字段字号");
    expect(() => parseTemplateDraft(draft({ line_gap: 1.5 }))).toThrow("行距");
    expect(() => parseTemplateDraft(draft({ fields: [{ key: "asset_code", prefix: "" }] }))).toThrow("至少选择一个有效字段");
    expect(() => parseTemplateDraft(draft({ name: "" }))).toThrow("模板名称");
    expect(() => parseTemplateDraft(draft({ base_template: "fancy" }))).toThrow("不支持的标签模板");
  });

  it("自定义前缀原样拼接，空前缀只打值；不传前缀时沿用「标签：值」", () => {
    const item = { id: 1, item_name: "琼脂糖", spec_model: "500g", brand: "示例品牌" };
    const t = parseTemplateDraft(draft());
    const prefixes = Object.fromEntries(t.fields.map((f) => [f.key, f.prefix]));
    expect(labelRows([item], "materials", t.fields.map((f) => f.key), prefixes)).toEqual([{ sample: "500g", note: "名称:琼脂糖；示例品牌" }]);
    expect(labelRows([item], "materials", ["item_name", "brand"])).toEqual([{ sample: "琼脂糖", note: "品牌：示例品牌" }]);
  });
});

describe("模板存库与选用", () => {
  it("按来源列出、解析为内置模板 + 样式，删除后不可再选", async () => {
    const t = parseTemplateDraft(draft());
    const [{ id }] = await query<{ id: number }>(
      "INSERT INTO label_templates(source,name,base_template,name_pt,detail_pt,line_gap,fields,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,1) RETURNING id",
      [t.source, t.name, t.base_template, t.name_pt, t.detail_pt, t.line_gap, JSON.stringify(t.fields)],
    );
    expect((await listTemplates(query, "materials")).map((x) => x.id)).toEqual([id]);
    expect(await listTemplates(query, "assets")).toEqual([]);

    const resolved = await resolveTemplate(query, "materials", { template_id: id });
    expect(resolved).toMatchObject({ template: "name-detail", templateId: id, label: "示例大字模板", style: { name_pt: 40, detail_pt: 16, line_gap: 6 }, fields: ["spec_model", "item_name", "brand"] });
    await expect(resolveTemplate(query, "freezer", { template_id: id })).rejects.toThrow("不适用于当前打印来源");
    expect(await resolveTemplate(query, "materials", { template: "uniform" })).toMatchObject({ template: "uniform", templateId: null });

    // 打印任务可记录模板编号
    await query("INSERT INTO label_print_jobs(request_id,user_id,printer_key,template,template_id,row_count,status) VALUES ('example-req',1,'example-printer',$1,$2,1,'sent')", [`materials:custom-${id}`, id]);
    expect((await query<{ template_id: number }>("SELECT template_id FROM label_print_jobs WHERE request_id='example-req'"))[0].template_id).toBe(id);

    await query("UPDATE label_templates SET is_deleted=true WHERE id=$1", [id]);
    await expect(resolveTemplate(query, "materials", { template_id: id })).rejects.toThrow("模板不存在或已删除");
    // 删除后可以再建同名模板
    await query("INSERT INTO label_templates(source,name,base_template,name_pt,detail_pt,line_gap,fields) VALUES ('materials',$1,'uniform',22,22,2,'[]')", [t.name]);
  });

  it("数据库约束拦住越界字号", async () => {
    await expect(query("INSERT INTO label_templates(source,name,base_template,name_pt,detail_pt,line_gap,fields) VALUES ('materials','越界','uniform',99,22,2,'[]')")).rejects.toThrow();
  });
});
