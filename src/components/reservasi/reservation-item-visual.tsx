import { cn } from "@/lib/utils";

type Variant = "tent" | "carrier" | "stove" | "gear";

export function ReservationItemVisual({
  variant = "tent",
  className,
  compact = false,
}: {
  variant?: Variant;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      "relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-50 via-stone-50 to-white text-emerald-900 ring-1 ring-black/5 dark:from-emerald-950/35 dark:via-slate-900 dark:to-slate-950 dark:text-emerald-200",
      compact ? "size-14" : "aspect-[4/3] w-full",
      className,
    )}>
      <div className="absolute inset-0 opacity-70">
        <svg viewBox="0 0 320 190" className="h-full w-full" aria-hidden="true">
          <path d="M0 145 68 90l48 38 67-86 65 79 72-54v123H0Z" fill="currentColor" opacity=".06" />
          <path d="M0 159 78 118l54 25 61-68 70 76 57-41v70H0Z" fill="currentColor" opacity=".08" />
        </svg>
      </div>

      <div className="absolute inset-0 grid place-items-center">
        {variant === "carrier" ? (
          <svg viewBox="0 0 120 120" className={cn(compact ? "size-9" : "size-24")} fill="none" aria-hidden="true">
            <path d="M42 27h36l7 18v45a9 9 0 0 1-9 9H44a9 9 0 0 1-9-9V45l7-18Z" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="3" />
            <path d="M49 27c0-8 6-13 11-13s11 5 11 13" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <path d="M35 47h50M48 58h24M48 72h24M48 86h24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : variant === "stove" ? (
          <svg viewBox="0 0 120 120" className={cn(compact ? "size-9" : "size-24")} fill="none" aria-hidden="true">
            <circle cx="60" cy="52" r="24" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="3" />
            <circle cx="60" cy="52" r="10" stroke="currentColor" strokeWidth="3" />
            <path d="M27 78h66M35 78l-5 17h60l-5-17M46 33l14-10 14 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : variant === "gear" ? (
          <svg viewBox="0 0 120 120" className={cn(compact ? "size-9" : "size-24")} fill="none" aria-hidden="true">
            <path d="M60 22 88 36v31L60 82 32 67V36L60 22Z" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="3" />
            <circle cx="60" cy="52" r="11" stroke="currentColor" strokeWidth="3" />
            <path d="m60 41 0-11M60 74v-10M49 52H38M82 52H71M52 44 44 36M68 60l8 8M68 44l8-8M52 60l-8 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 120 120" className={cn(compact ? "size-9" : "size-24")} fill="none" aria-hidden="true">
            <path d="m18 82 42-60 42 60H18Z" fill="currentColor" fillOpacity=".10" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
            <path d="m60 22 18 60M18 82l23-39M102 82 79 43" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <path d="M49 82h22" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
        )}
      </div>
    </div>
  );
}

ReservationItemVisual.displayName = "ReservationItemVisual";
