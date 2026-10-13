import { describe, expect, it } from "vitest";
import { matchesQuery } from "./filter";

describe("matchesQuery", () => {
  it("忽略大小写、全半角与空格", () => {
    expect(matchesQuery("HEK293T 细胞", "hek293t")).toBe(true);
    expect(matchesQuery("HEK293T", "ＨＥＫ２９３")).toBe(true);
    expect(matchesQuery("第 三 层", "三层")).toBe(true);
  });
  it("中文片段与多关键词", () => {
    expect(matchesQuery("超低温冰箱（-80℃）", "冰箱")).toBe(true);
    expect(matchesQuery("MSG-GA-1（GENE_A）", "ga gene")).toBe(true);
    expect(matchesQuery("MSG-GA-1", "GB")).toBe(false);
  });
  it("空关键词匹配全部", () => {
    expect(matchesQuery("任意", "  ")).toBe(true);
  });
});
