export function purchaseInfo(item: {
  item_name: string; brand: string; spec_model: string; unit: string;
  quantity: string | number | null; project_code: string; remarks: string;
}) {
  return [["名称", item.item_name], ["品牌", item.brand], ["规格型号", item.spec_model], ["单位", item.unit],
    ["数量", item.quantity], ["使用项目", item.project_code], ["备注", item.remarks]]
    .map(([label, value]) => `${label}：${value ?? ""}`).join("\n");
}
