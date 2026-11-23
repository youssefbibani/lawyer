import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { arTN } from "date-fns/locale";
import { CalendarDays } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-05-05" → "05/05/2026" (how lawyers write dates in Tunisia). */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * Reads a typed date, day first: «5/5/2026», «05-05-26», «5.5.2026», «05052026».
 * A two-digit year is in the 2000s. Returns an ISO date, or null if it is not a real day.
 */
export function parseTypedDate(text: string): string | null {
  const t = text.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  if (!t) return null;
  let parts: string[];
  if (/^\d{8}$/.test(t)) parts = [t.slice(0, 2), t.slice(2, 4), t.slice(4)];
  else if (/^\d{6}$/.test(t)) parts = [t.slice(0, 2), t.slice(2, 4), t.slice(4)];
  else parts = t.split(/[\s/.\-]+/);
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [d, m] = [Number(parts[0]), Number(parts[1])];
  let y = Number(parts[2]);
  if (parts[2].length <= 2) y += 2000;
  else if (parts[2].length !== 4) return null;
  if (y < 1900 || y > 2200) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const isoToDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

interface DateFieldProps {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  "aria-label"?: string;
  /** Preferred side for the calendar; it flips by itself when there is no room. */
  side?: "up" | "down";
}

/** A date the lawyer can type (day/month/year) or pick from a small calendar. */
export function DateField({ id, value, onChange, className, side = "down", ...rest }: DateFieldProps) {
  const [text, setText] = useState(isoToDisplay(value));
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);

  // Follow outside changes (scan, undo, reset).
  useEffect(() => {
    setText(isoToDisplay(value));
    setInvalid(false);
  }, [value]);

  function commit() {
    if (!text.trim()) {
      setInvalid(false);
      if (value) onChange("");
      return;
    }
    const iso = parseTypedDate(text);
    if (!iso) return setInvalid(true);
    setInvalid(false);
    setText(isoToDisplay(iso));
    if (iso !== value) onChange(iso);
  }

  return (
    // The calendar floats above the page (it never stretches or scrolls the form it sits in).
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative">
          <input
            id={id}
            type="text"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            placeholder="05/05/2026"
            aria-invalid={invalid || undefined}
            title={invalid ? "تاريخ غير صحيح: اكتب اليوم/الشهر/السنة، مثال 05/05/2026" : undefined}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setInvalid(false);
            }}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())}
            className={cn("flex w-full min-w-0 pe-9 text-left font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground", invalid && "!bg-alert/10 text-alert", className)}
            aria-label={rest["aria-label"]}
          />
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label="اختيار التاريخ من الرزنامة"
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-gold-deep focus-visible:text-gold-deep focus-visible:outline-none"
            >
              <CalendarDays className="h-4 w-4" />
            </button>
          </Popover.Trigger>
          {invalid && (
            <p role="alert" className="absolute top-full z-10 mt-0.5 whitespace-nowrap text-[11px] text-alert">
              اكتب اليوم/الشهر/السنة، مثال 05/05/2026
            </p>
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          aria-label="الرزنامة"
          side={side === "up" ? "top" : "bottom"}
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 w-80 max-w-[calc(100vw-16px)] rounded-[var(--radius)] border border-border bg-popover text-popover-foreground shadow-lg outline-none"
        >
          <Calendar
            mode="single"
            locale={arTN}
            weekStartsOn={1}
            selected={value ? isoToDate(value) : undefined}
            defaultMonth={value ? isoToDate(value) : undefined}
            initialFocus
            onSelect={(d) => {
              if (!d) return;
              onChange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
