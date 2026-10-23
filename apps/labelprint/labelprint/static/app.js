// 标签打印网页前端逻辑。index.html 与 history.html 共用这一个文件，
// 通过检测页面上是否存在特定元素来决定要不要初始化对应页面的行为。

const OPERATOR_KEY = "labelprint_operator";   // localStorage：操作人，跨次访问记住
const REPRINT_KEY = "labelprint_reprint_rows"; // sessionStorage：历史页“重打”时传数据回首页
const STATUS_POLL_MS = 15000;                  // 打印机状态条刷新间隔

// ---------- 打印机状态条（首页、历史页共用） ----------

async function refreshStatus() {
  const el = document.getElementById("printer-status");
  if (!el) return;
  try {
    const res = await fetch("/api/status");
    const body = await res.json();
    let text, cls;
    if (body.ready) {
      const backlog = typeof body.jobs === "number" && body.jobs > 1;
      cls = backlog ? "status-bar status-warn" : "status-bar status-ok";
      text = "打印机就绪";
      if (body.jobs) text += "，队列中 " + body.jobs + " 个作业";
      if (body.notes) text += "（" + body.notes + "）";
    } else {
      cls = "status-bar status-error";
      text = "打印机未就绪：" + (body.reason || "原因未知");
    }
    el.textContent = text;
    el.className = cls;
  } catch (e) {
    el.textContent = "无法查询打印机状态";
    el.className = "status-bar status-error";
  }
}

// ---------- 小工具 ----------

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function hideError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

// ---------- 首页：数据表格 ----------

function addRow(data) {
  data = data || {};
  const tr = document.createElement("tr");
  tr.innerHTML =
    '<td><input type="text" class="cell-sample" placeholder="必填"></td>' +
    '<td><input type="text" class="cell-conc"></td>' +
    '<td><input type="text" class="cell-ratio"></td>' +
    '<td><input type="text" class="cell-note"></td>' +
    '<td><button type="button" class="row-del-btn">删除</button></td>';
  // 值通过属性赋值写入，不拼进 innerHTML 字符串，避免样品名里带 " 或 < 等字符破坏页面
  tr.querySelector(".cell-sample").value = data.sample || "";
  tr.querySelector(".cell-conc").value = data.conc || "";
  tr.querySelector(".cell-ratio").value = data.ratio || "";
  tr.querySelector(".cell-note").value = data.note || "";
  document.getElementById("data-tbody").appendChild(tr);
}

function clearTable() {
  document.getElementById("data-tbody").innerHTML = "";
}

function collectTableRows() {
  const trs = document.querySelectorAll("#data-tbody tr");
  const rows = [];
  trs.forEach((tr) => {
    rows.push({
      sample: tr.querySelector(".cell-sample").value,
      conc: tr.querySelector(".cell-conc").value,
      ratio: tr.querySelector(".cell-ratio").value,
      note: tr.querySelector(".cell-note").value,
    });
  });
  return rows;
}

// 让"预览"与"当前表格"这两份数据失去关联：隐藏预览区、清空已勾选的行快照。
// 任何会改变表格内容的操作（增行、删行、改单元格、重新上传/重打填表）都必须
// 调用这个函数——否则 previewRows 会停留在旧值上，用户在预览之后修改表格、
// 不重新预览就直接点「打印」，送出的会是修改前的旧数据（可能是已经删掉的行），
// 而不是屏幕上实际看到的内容。这类问题在纯手点测试里很容易被漏掉，因为
// "编辑 -> 预览"这条顺序永远是对的，只有反过来"预览 -> 编辑"才会暴露。
function invalidatePreview() {
  const section = document.getElementById("preview-section");
  const hadPreview = !!(section && !section.hidden);
  previewRows = [];
  if (section) section.hidden = true;
  const grid = document.getElementById("preview-grid");
  if (grid) grid.innerHTML = "";
  const resultEl = document.getElementById("print-result");
  if (resultEl) resultEl.hidden = true;
  // 只有「之前确实有一份预览」时才提示，避免页面刚打开、表格还没预览过就弹提示
  if (hadPreview) {
    showError("stale-hint", "表格已修改，之前的预览已失效，请重新预览后再打印");
  }
}

function fillTable(rows) {
  invalidatePreview(); // 整表被替换（上传新文件 / 重打填表），旧预览必须作废
  clearTable();
  if (rows && rows.length) {
    rows.forEach((r) => addRow(r));
  } else {
    addRow({});
  }
}

// ---------- 首页：文件上传 / 拖拽 ----------

async function handleFile(file) {
  hideError("parse-error");
  const fd = new FormData();
  fd.append("file", file);
  let res, body;
  try {
    res = await fetch("/api/parse", { method: "POST", body: fd });
    body = await res.json();
  } catch (e) {
    showError("parse-error", "上传失败，请检查网络或服务是否在运行");
    return;
  }
  if (!res.ok) {
    showError("parse-error", body.error || "解析失败");
    return;
  }
  // 上传视为“重新填一遍表”：清空当前表格再填入解析结果
  fillTable(body.rows);
}

// ---------- 首页：预览 ----------

let previewRows = []; // 与最近一次预览请求一一对应的行数据，供“打印”按勾选取用

function renderPreviewGrid(images, rows) {
  const grid = document.getElementById("preview-grid");
  grid.innerHTML = "";
  images.forEach((b64, i) => {
    const card = document.createElement("div");
    card.className = "preview-card";

    const img = document.createElement("img");
    img.src = "data:image/png;base64," + b64;
    img.alt = (rows[i] && rows[i].sample) || "";
    card.appendChild(img);

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.className = "preview-check";
    checkbox.dataset.index = String(i);
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(" 打印这张"));
    card.appendChild(label);

    grid.appendChild(card);
  });
}

function updatePrintCount() {
  const checked = document.querySelectorAll(".preview-check:checked").length;
  const copiesVal = parseInt(document.getElementById("copies").value, 10);
  const copies = copiesVal > 0 ? copiesVal : 1;
  document.getElementById("print-count").textContent = String(checked * copies);
}

async function handlePreview() {
  hideError("preview-error");
  document.getElementById("print-result").hidden = true;

  const allRows = collectTableRows();
  const nonBlank = normalizeRows(allRows);

  let res, body;
  try {
    res = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: nonBlank }),
    });
    body = await res.json();
  } catch (e) {
    // preview-section 默认是隐藏的（首次预览失败）或者可能被 invalidatePreview()
    // 重新隐藏过（编辑表格后再次预览又失败）；错误提示 #preview-error 是这个
    // section 的子元素，容器不显示，子元素的文字再准确用户也看不到——
    // 这里必须显式把容器打开，否则就是"点了没反应"，没有任何可见信号。
    document.getElementById("preview-section").hidden = false;
    showError("preview-error", "预览失败，请检查网络或服务是否在运行");
    return;
  }
  if (!res.ok) {
    document.getElementById("preview-section").hidden = false;
    showError("preview-error", body.error || "预览失败");
    return;
  }

  previewRows = nonBlank;
  renderPreviewGrid(body.images, previewRows);
  document.getElementById("preview-section").hidden = false;
  hideError("stale-hint"); // 预览刚刚重新生成，和当前表格重新对上了
  updatePrintCount();
}

// ---------- 首页：打印 ----------

async function handlePrint() {
  // 不变量：点「打印」送出的数据必须与用户当前屏幕上看到的预览严格一致。
  // 这里现场重新读一遍表格（不依赖"表格改动时有没有记得触发作废"这件事），
  // 跟上一次预览的快照做内容比对——这是最后一道防线，按构造堵死所有让表格
  // 和预览失去同步的路径，不管是加行删行改单元格，还是绕过 input 事件的
  // 程序化赋值。前面各处事件触发的 invalidatePreview() 仍然保留，它们负责
  // 第一时间给用户视觉反馈（隐藏预览区、显示提示），体验更好，但不是这里
  // 依赖的安全保证来源。
  const currentRows = normalizeRows(collectTableRows());

  if (!currentRows.length) {
    document.getElementById("preview-section").hidden = false;
    const resultEl = document.getElementById("print-result");
    resultEl.hidden = false;
    resultEl.textContent = "表格里没有可打印的样品，请先填写样品名称";
    resultEl.className = "result-msg result-error";
    return;
  }

  if (!rowsEqual(currentRows, previewRows)) {
    document.getElementById("preview-section").hidden = false;
    const resultEl = document.getElementById("print-result");
    resultEl.hidden = false;
    resultEl.textContent = "表格内容与最近一次预览不一致，请重新预览后再打印";
    resultEl.className = "result-msg result-error";
    return;
  }

  const checks = document.querySelectorAll(".preview-check");
  const selected = [];
  checks.forEach((cb) => {
    if (cb.checked) selected.push(previewRows[Number(cb.dataset.index)]);
  });

  const copiesVal = parseInt(document.getElementById("copies").value, 10);
  const copies = copiesVal > 0 ? copiesVal : 1;
  const operator = document.getElementById("operator").value;

  // 一次要打的张数很大时二次确认一下——误传大表或份数填错很容易一次
  // 送出几千张，浪费标签纸且不容易中途叫停。这里在真正禁用按钮、发请求
  // 之前就问，用户点"取消"就直接退出，不留任何副作用。
  const totalCount = selected.length * copies;
  if (totalCount > 100 && !window.confirm("将打印 " + totalCount + " 张，确定吗？")) {
    return;
  }

  // 不变量：一次「打印」点击最多只能触发一个 /api/print 请求。真机上打印机
  // 状态查询 + send_raw 走 spooler 有真实耗时，双击是这类桌面软件里的肌肉
  // 记忆动作（尤其对不熟悉网页交互的实验室用户），审查已实测确认不禁用按钮
  // 时双击会真的发出两个请求、把同一批标签打两遍。禁用按钮后，浏览器对
  // disabled 元素的原生行为会拦住第二次点击（不管是真实双击还是脚本连续
  // 调 .click()），不需要额外的"是否正在进行中"标志位。
  const btn = document.getElementById("print-btn");
  if (btn) btn.disabled = true;
  try {
    let res, body;
    try {
      res = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: selected, copies: copies, operator: operator }),
      });
      body = await res.json();
    } catch (e) {
      document.getElementById("preview-section").hidden = false;
      const resultEl = document.getElementById("print-result");
      resultEl.hidden = false;
      resultEl.textContent = "打印请求失败，请检查网络或服务是否在运行";
      resultEl.className = "result-msg result-error";
      return;
    }

    // fetch("/api/print") 这次 await 期间，表格完全可能被编辑（真机上打印机
    // 状态查询 + send_raw 走 spooler 都有真实耗时），invalidatePreview() 会
    // 把 preview-section 重新隐藏——这里必须强制打开，否则打印到底成没成功，
    // 用户会完全看不到，体感是"点了没反应"，容易诱发重复送单、浪费标签纸。
    document.getElementById("preview-section").hidden = false;
    const resultEl = document.getElementById("print-result");
    resultEl.hidden = false;
    if (!res.ok) {
      resultEl.textContent = body.error || "打印失败";
      resultEl.className = "result-msg result-error";
      return;
    }

    let msg = body.message;
    if (body.queue_backlog) {
      msg += "；打印队列有积压（当前排队 " + body.queue_jobs + " 个作业），请检查打印机";
    }
    resultEl.textContent = msg;
    resultEl.className = body.queue_backlog ? "result-msg result-warn" : "result-msg result-ok";

    // 刷新一次状态条，让积压情况立刻反映在常驻状态条上
    refreshStatus();
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- 首页初始化 ----------

function initIndexPage() {
  document.getElementById("add-row-btn").addEventListener("click", () => {
    addRow({});
    invalidatePreview(); // 加了一行，旧预览不再代表当前表格
  });

  document.getElementById("data-tbody").addEventListener("click", (e) => {
    if (e.target.classList.contains("row-del-btn")) {
      e.target.closest("tr").remove();
      invalidatePreview(); // 删了一行，旧预览里可能还留着这一行的图，必须作废
    }
  });

  // 事件委托：任何一个单元格被编辑（哪怕只是加个空格）都视为表格已变化。
  // 用 input 而不是 change，改完不失焦也能立刻作废，不给"改完直接点打印"留窗口。
  document.getElementById("data-tbody").addEventListener("input", () => {
    invalidatePreview();
  });

  const dropzone = document.getElementById("dropzone");
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  document.getElementById("file-input").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
  });

  document.getElementById("preview-btn").addEventListener("click", handlePreview);
  document.getElementById("print-btn").addEventListener("click", handlePrint);
  document.getElementById("preview-grid").addEventListener("change", (e) => {
    if (e.target.classList.contains("preview-check")) updatePrintCount();
  });
  document.getElementById("copies").addEventListener("input", updatePrintCount);

  const operatorInput = document.getElementById("operator");
  operatorInput.value = localStorage.getItem(OPERATOR_KEY) || "";
  operatorInput.addEventListener("input", () => {
    localStorage.setItem(OPERATOR_KEY, operatorInput.value);
  });

  // 历史页“重打”跳转过来时，sessionStorage 里带着要填回表格的数据
  const stored = sessionStorage.getItem(REPRINT_KEY);
  if (stored) {
    sessionStorage.removeItem(REPRINT_KEY);
    try {
      fillTable(JSON.parse(stored));
    } catch (e) {
      addRow({});
    }
  } else {
    addRow({});
  }
}

// ---------- 历史页 ----------

function historyCellText(row) {
  return row.ok ? "成功" : "失败：" + (row.err || "");
}

async function loadHistory(keyword) {
  const url = keyword ? "/api/history?q=" + encodeURIComponent(keyword) : "/api/history";
  const res = await fetch(url);
  const body = await res.json();
  const tbody = document.getElementById("history-tbody");
  tbody.innerHTML = "";

  body.rows.forEach((r) => {
    const tr = document.createElement("tr");
    if (!r.ok) tr.classList.add("row-failed");

    const values = [
      r.ts, (r.batch_id || "").slice(0, 8), r.sample, r.conc, r.ratio, r.note,
      r.copies, r.operator, historyCellText(r),
    ];
    values.forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v === null || v === undefined ? "" : String(v);
      tr.appendChild(td);
    });

    const actionTd = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary reprint-btn";
    btn.textContent = "重打";
    btn.dataset.batchId = r.batch_id;
    actionTd.appendChild(btn);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  });
}

async function handleReprint(batchId) {
  const res = await fetch("/api/batch/" + encodeURIComponent(batchId));
  const body = await res.json();
  sessionStorage.setItem(REPRINT_KEY, JSON.stringify(body.rows));
  window.location.href = "/";
}

function initHistoryPage() {
  loadHistory("");

  document.getElementById("search-btn").addEventListener("click", () => {
    loadHistory(document.getElementById("search-input").value.trim());
  });
  document.getElementById("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadHistory(document.getElementById("search-input").value.trim());
    }
  });
  document.getElementById("history-tbody").addEventListener("click", (e) => {
    if (e.target.classList.contains("reprint-btn")) {
      handleReprint(e.target.dataset.batchId);
    }
  });
}

// ---------- 入口 ----------

document.addEventListener("DOMContentLoaded", () => {
  refreshStatus();
  setInterval(refreshStatus, STATUS_POLL_MS);

  if (document.getElementById("data-tbody")) {
    initIndexPage();
  }
  if (document.getElementById("history-tbody")) {
    initHistoryPage();
  }
});
