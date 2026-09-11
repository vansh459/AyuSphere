import { cn } from "@/lib/utils";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-[0.875rem] border border-line bg-surface px-3 text-body text-ink transition-all duration-200 outline-none placeholder:opacity-50 focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("microlabel block", className)} {...props} />;
}
