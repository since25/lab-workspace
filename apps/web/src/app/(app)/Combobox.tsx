"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { matchesQuery } from "@/lib/filter";

export interface Option {
  value: string;
  label: string;
}

// 可输入筛选的下拉框：替代原生 select。
// 输入法组字过程中不触发回车选择；筛选忽略大小写、全半角与空格，多个关键词用空格分隔。
export default function Combobox({
  value, options, onChange, placeholder = "请选择", allowEmpty = false, emptyLabel = "全部", style,
}: {
  value: string;
  options: (Option | string)[];
  onChange: (v: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  style?: React.CSSProperties;
}) {
  const opts = useMemo<Option[]>(() => {
    const list = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
    return allowEmpty ? [{ value: "", label: emptyLabel }, ...list] : list;
  }, [options, allowEmpty, emptyLabel]);
  const selected = opts.find((o) => o.value === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const composing = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const filtered = useMemo(() => opts.filter((o) => matchesQuery(o.label, query)), [opts, query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function pick(o: Option) {
    onChange(o.value);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (composing.current || e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[active]) {
        e.preventDefault();
        pick(filtered[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="combo" ref={root} style={style}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        value={open ? query : selected?.label ?? ""}
        placeholder={open ? selected?.label || "输入关键字筛选" : placeholder}
        onFocus={() => { setOpen(true); setQuery(""); setActive(0); }}
        onClick={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={(e) => { composing.current = false; setQuery(e.currentTarget.value); }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="combo-list" id={listId} role="listbox">
          {filtered.map((o, i) => (
            <li
              key={o.value + i}
              role="option"
              aria-selected={o.value === value}
              className={(i === active ? "active " : "") + (o.value === value ? "selected" : "")}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}
            >
              {o.label}
            </li>
          ))}
          {!filtered.length && <li className="muted empty">没有匹配项</li>}
        </ul>
      )}
    </div>
  );
}
