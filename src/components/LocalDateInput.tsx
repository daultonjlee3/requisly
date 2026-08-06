"use client";

import { useState } from "react";
import { todayDateInputValue } from "@/lib/pricing";

/** Date input defaulted to the browser's local today (not SSR UTC). */
export function LocalDateInput({
  id,
  name,
  className,
  required,
}: {
  id: string;
  name: string;
  className?: string;
  required?: boolean;
}) {
  const [value, setValue] = useState(todayDateInputValue);

  return (
    <input
      id={id}
      name={name}
      type="date"
      className={className}
      required={required}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
