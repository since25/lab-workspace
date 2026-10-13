"use client";

export interface Sort {
  key: string;
  dir: "asc" | "desc";
}

// 可点击排序的表头：首次点击按该列排序，再次点击切换升序/降序
export default function SortTh({ k, label, sort, onSort }: { k: string; label: string; sort: Sort; onSort: (s: Sort) => void }) {
  const on = sort.key === k;
  return (
    <th
      className="sortable"
      aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      onClick={() => onSort({ key: k, dir: on && sort.dir === "asc" ? "desc" : "asc" })}
    >
      {label}
      <span className="arrow">{on ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
    </th>
  );
}
