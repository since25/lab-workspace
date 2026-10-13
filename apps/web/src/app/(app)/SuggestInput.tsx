"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { matchesQuery } from "@/lib/filter";

// 可自由输入、带候选下拉的输入框：输入的内容就是值，候选按已输入文字筛选（规则同 Combobox），点选即填入。
// 用于「台账里已有的值可直接选，新值手填」的字段。
export default function SuggestInput({
  value, options, onChange, placeholder,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const composing = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  // 已完全等于某个候选时仍显示全部候选，方便改选
  const filtered = useMemo(
    () => (options.includes(value) ? options : options.filter((o) => matchesQuery(o, value))).slice(0, 200),
    [options, value]
  );

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
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
      if (open && filtered[active] !== undefined) {
        e.preventDefault();
        pick(filtered[active]);
      }
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="combo" ref={root}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        value={value}
        placeholder={placeholder ?? (options.length ? "可选择或直接输入" : "")}
        onFocus={() => { setOpen(true); setActive(-1); }}
        onClick={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={onKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul className="combo-list" id={listId} role="listbox">
          {filtered.map((o, i) => (
            <li
              key={o}
              role="option"
              aria-selected={o === value}
              className={(i === active ? "active " : "") + (o === value ? "selected" : "")}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
