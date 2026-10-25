import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { labelRows } from "./label-sources";
import { BUILTIN_STYLES, listTemplates, parseStyleOverride, parseTemplateDraft, resolveDraft, resolveTemplate } from "./label-templates";
import type { MaterialQuery } from "./materials-list";

const db = new PGlite();
const query: MaterialQuery = async <T,>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows;
const draft = (changes: Record<string, unknown> = {}) => ({
  source: "materials", name: "示例大字模板", base_template: "name-detail", name_pt: 40, detail_pt: 16, line_gap: 6,
  fields: [{ key: "spec_model", prefix: "" }, { key: "item_name", prefix: "名称:" }, { key: "brand", prefix: "" }],
  ...changes,
});

// 全部迁移按序执行一遍，验证模板迁移能接在现有结构之后
beforeAll(async () => {
  const dir = new URL("../../../../db/migrations/", import.meta.url);
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(file, dir), "utf8"));
  }
  await db.exec("INSERT INTO users(id,username,display_name,password_hash,role) VALUES (1,'example-admin','示例管理员','example-hash','admin')");
}, 60000);
afterAll(() => db.close());

describe("自定义模板校验", () => {
  it("对齐缺省为左对齐，草稿预览保留两种对齐", () => {
    expect(parseTemplateDraft(draft())).toMatchObject({ name_align: "left", detail_align: "left" });
    expect(resolveDraft(parseTemplateDraft(draft({ name_align: "center", detail_align: "right" }))).style)
      .toMatchObject({ name_align: "center", detail_align: "right" });
    expect(() => parseTemplateDraft(draft({ name_align: "justify" }))).toThrow("名称对齐");
    expect(() => parseTemplateDraft(draft({ detail_align: null }))).toThrow("字段对齐");
  });

  it("自定义 CSV 接受任意列名、去重并跳过空列名，缺失列不参与排版", () => {
    const t = parseTemplateDraft(draft({ source: "custom", fields: [
      { key: "示例名称", prefix: "" }, { key: "示例分类", prefix: "分类：" },
      { key: "示例名称", prefix: "重复" }, { key: " ", prefix: "" }, { key: 42, prefix: "" },
    ] }));
    expect(t.fields).toEqual([{ key: "示例名称", prefix: "" }, { key: "示例分类", prefix: "分类：" }]);
    const resolved = resolveDraft(t);
    expect(labelRows([{ id: 1, 示例名称: "示例条目" }], "custom", resolved.fields!, resolved.prefixes))
      .toEqual([{ sample: "示例条目", note: "" }]);
  });

  it("自定义 CSV 限制列名长度与去重后的字段数", () => {
    const fields = Array.from({ length: 30 }, (_, i) => ({ key: `示例列${i}`, prefix: "" }));
    expect(parseTemplateDraft(draft({ source: "custom", fields: [...fields, fields[0]] })).fields).toHaveLength(30);
    expect(() => parseTemplateDraft(draft({ source: "custom", fields: [...fields, { key: "额外示例列", prefix: "" }] }))).toThrow("30");
    expect(parseTemplateDraft(draft({ source: "custom", fields: [{ key: "列".repeat(60), prefix: "" }] })).fields).toHaveLength(1);
    expect(() => parseTemplateDraft(draft({ source: "custom", fields: [{ key: "列".repeat(61), prefix: "" }] }))).toThrow("60");
    expect(() => parseTemplateDraft(draft({ source: "custom", fields: [{ key: "", prefix: "" }] }))).toThrow("有效字段");
  });

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

describe("本次打印样式覆盖", () => {
  const base = BUILTIN_STYLES["name-detail"];

  it("合并合法覆盖并保留默认值，不修改原样式", () => {
    expect(parseStyleOverride({ name_pt: 40, line_gap: 0, name_align: "center", detail_align: "right" }, base))
      .toEqual({ ...base, name_pt: 40, line_gap: 0, name_align: "center", detail_align: "right" });
    expect(base.name_pt).toBe(34);
    expect(parseStyleOverride({}, base)).toEqual(base);
    expect(parseStyleOverride(null, base)).toBeUndefined();
    expect(parseStyleOverride(undefined, base)).toBeUndefined();
  });

  it("拒绝非对象、越界字号、非整数行距和非法对齐", () => {
    for (const value of [[], "left", 42, true]) expect(() => parseStyleOverride(value, base)).toThrow("必须是对象");
    for (const value of [11, 73, 34.5]) expect(() => parseStyleOverride({ name_pt: value }, base)).toThrow("名称字号");
    for (const value of [9, 49]) expect(() => parseStyleOverride({ detail_pt: value }, base)).toThrow("字段字号");
    for (const value of [-1, 21, 1.5, null, false, [], "2"]) expect(() => parseStyleOverride({ line_gap: value }, base)).toThrow("行距");
    expect(() => parseStyleOverride({ name_align: "justify" }, base)).toThrow("名称对齐");
    expect(() => parseStyleOverride({ detail_align: null }, base)).toThrow("字段对齐");
  });

  it("内置模板不微调时不含 style；微调时合并对应内置默认值", async () => {
    for (const template of ["name-detail", "uniform", "name-only"] as const) {
      expect(await resolveTemplate(query, "materials", { template })).not.toHaveProperty("style");
      expect(await resolveTemplate(query, "materials", { template, style_override: null })).not.toHaveProperty("style");
      expect((await resolveTemplate(query, "materials", { template, style_override: { name_align: "right" } })).style)
        .toEqual({ ...BUILTIN_STYLES[template], name_align: "right" });
    }
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
    expect(resolved.style).toMatchObject({ name_align: "left", detail_align: "left" });
    await query("UPDATE label_templates SET name_align='center', detail_align='right' WHERE id=$1", [id]);
    expect((await listTemplates(query, "materials"))[0]).toMatchObject({ name_align: "center", detail_align: "right" });
    expect((await resolveTemplate(query, "materials", { template_id: id, style_override: { name_pt: 42 } })).style)
      .toEqual({ name_pt: 42, detail_pt: 16, line_gap: 6, name_align: "center", detail_align: "right" });
    expect((await resolveTemplate(query, "materials", { template_id: id })).style?.name_pt).toBe(40);
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

  it("数据库约束拦住非法对齐", async () => {
    for (const column of ["name_align", "detail_align"]) {
      await expect(query(`INSERT INTO label_templates(source,name,base_template,name_pt,detail_pt,line_gap,fields,${column}) VALUES ('materials','非法对齐','uniform',22,22,2,'[]','justify')`)).rejects.toThrow();
    }
  });
});
