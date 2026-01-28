import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const statusBadgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-muted text-muted-foreground",
        natural: "bg-primary/10 text-primary",
        corporate: "bg-muted text-muted-foreground",
        director: "bg-muted text-muted-foreground",
        secretary: "bg-muted text-muted-foreground",
        shareholder: "bg-muted text-muted-foreground",
        paid: "bg-primary/10 text-primary",
        pending: "bg-warning/10 text-warning",
        overdue: "bg-destructive/10 text-destructive",
        success: "bg-primary/10 text-primary",
        warning: "bg-warning/10 text-warning",
        error: "bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface StatusBadgeProps extends VariantProps<typeof statusBadgeVariants> {
  children: React.ReactNode;
  className?: string;
}

export const StatusBadge = ({ variant, children, className }: StatusBadgeProps) => {
  return (
    <span className={cn(statusBadgeVariants({ variant }), className)}>
      {children}
    </span>
  );
};
