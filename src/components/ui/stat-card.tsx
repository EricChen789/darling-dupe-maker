import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  className?: string;
  valueClassName?: string;
}

export const StatCard = ({ label, value, className, valueClassName }: StatCardProps) => {
  return (
    <div className={cn("bg-card border border-border rounded-lg p-4", className)}>
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      <div className={cn("text-2xl font-semibold", valueClassName)}>{value}</div>
    </div>
  );
};
