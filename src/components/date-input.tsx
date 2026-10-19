"use client";

import { useRef, useState } from "react";
import { dmy, parseDmy } from "@/lib/format";

const shown = (iso: string | undefined) => (iso ? dmy(iso) : "");

/** Typed digits -> "21/12/1993", adding the slashes as you type. */
function mask(text: string): string {
  const d = text.replace(/\D/g, "").slice(0, 8);
  return d.slice(0, 2) + (d.length > 2 ? "/" + d.slice(2, 4) : "") + (d.length > 4 ? "/" + d.slice(4) : "");
}

/**
 * A date box that always shows and takes DD/MM/YYYY (21/12/1993), whatever the phone or browser language.
 * The value going in and out is "YYYY-MM-DD" ("" while incomplete). Use `value` + `onChange` in client forms,
 * or `name` + `defaultValue` in plain (GET) forms: a hidden field then carries the YYYY-MM-DD value.
 * The calendar button still opens the device's date picker.
 */
export function DateInput({
  value, defaultValue, onChange, name, min, max, required, className = "", id, ...aria
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  name?: string;
  min?: string;
  max?: string;
  required?: boolean;
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const start = value ?? defaultValue ?? "";
  const [text, setText] = useState(shown(start));
  const [iso, setIso] = useState(start);
  // a new value from the parent (e.g. a form reset) replaces what is typed
  const [seen, setSeen] = useState(value);
  if (value !== undefined && value !== seen) {
    setSeen(value);
    if (value !== iso) {
      setIso(value);
      setText(shown(value));
    }
  }
  const picker = useRef<HTMLInputElement>(null);

  const take = (t: string) => {
    setText(t);
    const v = parseDmy(t);
    const out = v && ((min && v < min) || (max && v > max)) ? "" : v;
    setIso(out);
    onChange?.(out);
  };
  const bad = text.length === 10 && !iso;

  return (
    <span className={`relative ${/\bw-full\b/.test(className) ? "block" : "inline-block"}`}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        maxLength={10}
        required={required}
        pattern="\d{2}/\d{2}/\d{4}"
        title="DD/MM/YYYY, e.g. 21/12/1993"
        value={text}
        onChange={(e) => take(mask(e.target.value))}
        aria-invalid={aria["aria-invalid"] || bad || undefined}
        aria-describedby={aria["aria-describedby"]}
        className={`${className} num pr-10 ${bad ? "border-red-500" : ""}`}
      />
      {name && <input type="hidden" name={name} value={iso} />}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open calendar"
        onClick={() => {
          const p = picker.current;
          if (!p) return;
          try {
            p.showPicker();
          } catch {
            p.focus();
          }
        }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-500 hover:text-blue-700"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        min={min}
        max={max}
        value={iso}
        onChange={(e) => take(shown(e.target.value))}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
      />
    </span>
  );
}
