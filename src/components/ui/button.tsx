import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[0.875rem] font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] cursor-pointer",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-white shadow-[0_1px_2px_rgba(28,30,29,0.05),0_6px_12px_rgba(27,122,67,0.25)] hover:bg-primary-deep hover:-translate-y-[2px]",
        clay: "clay-btn text-ink hover:-translate-y-[2px]",
        ghost: "text-ink/70 hover:bg-primary-soft hover:text-ink",
        danger:
          "bg-danger text-white shadow-[0_1px_2px_rgba(28,30,29,0.05),0_6px_12px_rgba(192,57,43,0.25)] hover:-translate-y-[2px]",
        outline: "border border-line bg-surface text-ink hover:bg-primary-soft",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
