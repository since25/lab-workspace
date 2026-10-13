// Sanger 结果命名规则的前端预览，严格对应分析服务 R/data_processing.R 的 compute_rename_map：
// 1) 用规则对完整文件名做全局正则替换（R gsub perl=TRUE），结果去首尾空格，替换成空串时保留原名；
// 2) 去掉 .ab1 扩展名；3) 按文件名排序后重名的依次加 _dup1、_dup2；4) 有后缀时追加「_后缀」。
// 预设与 api.R 中的 rename_presets 一致；替换串用 R 写法 \1 表示第一个括号。

export const RENAME_PRESETS = [
  { id: "", label: "不重命名（去掉 .ab1）", pattern: "", replacement: "" },
  { id: "combined_default", label: "保留前两段（R1-9.IDUAR.3380632.G05.ab1 → R1-9.IDUAR）", pattern: "^([^.]+\\.[^.]+)\\..*$", replacement: "\\1" },
  { id: "strip_leading_index", label: "去掉开头序号（12_xxx → xxx）", pattern: "^[0-9]+_", replacement: "" },
  { id: "keep_index_and_primer", label: "只保留序号和引物（12_P1_xxx → 12_P1）", pattern: "^([0-9]+_[^_]+).*$", replacement: "\\1" },
  { id: "strip_tss_suffix", label: "去掉 _TSS 后缀", pattern: "_TSS[0-9-]+_[A-Z][0-9]{2}\\.ab1$", replacement: "" },
  { id: "custom", label: "自定义正则", pattern: "", replacement: "" },
];

// 与 R normalize_tag 一致：非 [A-Za-z0-9._-] 的字符换成下划线，合并连续下划线，去掉首尾下划线
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

// R 替换串 \1 → JS $1；字面 $ 需转义
function toJsReplacement(r: string): string {
  return r.replace(/\$/g, "$$$$").replace(/\\(\d)/g, "$$$1");
}

// R 的 sort/order 在 C 语言环境下按字节序；这里用码点序，排序只影响重名时 _dup 编号的分配
function byCodePoint(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function previewNames(fileNames: string[], pattern: string, replacement: string, tag = ""): string[] {
  let re: RegExp | null = null;
  if (pattern) re = new RegExp(pattern, "g");
  const sorted = fileNames.map((name, i) => ({ name, i })).sort((a, b) => byCodePoint(a.name, b.name));
  const used = new Map<string, number>();
  const seen = new Set<string>();
  const out: string[] = new Array(fileNames.length);
  const t = normalizeTag(tag);
  for (const { name, i } of sorted) {
    let base = name;
    if (re) {
      re.lastIndex = 0;
      const replaced = name.replace(re, toJsReplacement(replacement)).trim();
      base = replaced === "" ? name : replaced;
    }
    base = base.replace(/\.ab1$/i, "");
    // make.unique(sep = "_dup")：第一次出现保留原样，之后依次 _dup1、_dup2，并跳过已占用的名字
    let unique = base;
    if (seen.has(base)) {
      let n = used.get(base) ?? 1;
      while (seen.has(`${base}_dup${n}`)) n++;
      unique = `${base}_dup${n}`;
      used.set(base, n + 1);
    }
    seen.add(unique);
    out[i] = t ? `${unique}_${t}` : unique;
  }
  return out;
}
