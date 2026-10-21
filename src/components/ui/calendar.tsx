import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      dir="rtl"
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4 w-full",
        month: "space-y-4 w-full",
        caption: "flex justify-center pt-1 relative items-center font-heading",
        caption_label: "text-base",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-9 w-9 bg-transparent p-0 opacity-80 hover:opacity-100 coarse:h-11 coarse:w-11",
        ),
        nav_button_previous: "absolute right-1",
        nav_button_next: "absolute left-1",
        table: "w-full border-collapse space-y-1 table-fixed",
        head_row: "flex w-full",
        head_cell: "text-muted-foreground rounded-md flex-1 sm:w-9 sm:flex-none coarse:!w-11 font-normal text-xs",
        row: "flex w-full mt-1",
        cell: "h-11 flex-1 sm:h-9 sm:w-9 sm:flex-none coarse:!h-11 coarse:!w-11 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-11 w-full sm:h-9 sm:w-9 coarse:!h-11 coarse:!w-full p-0 font-normal aria-selected:opacity-100 rounded-[var(--radius)]",
        ),
        day_selected:
          "bg-gold text-ink hover:bg-gold hover:text-ink focus:bg-gold focus:text-ink font-semibold",
        day_today: "border border-gold text-foreground",
        day_outside: "text-muted-foreground opacity-40",
        day_disabled: "text-muted-foreground opacity-40",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: () => <ChevronRight className="h-4 w-4" />,
        IconRight: () => <ChevronLeft className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
