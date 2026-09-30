import { AlertCircle, CheckCircle2, CircleDashed, Clock3, LockKeyhole, LockKeyholeOpen, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { reservationStatusPresentation, reservationToneClasses, stockLockPresentation } from "./reservation-status";

export function ReservationStatusBadge({ status }: { status: string }) {
  const view = reservationStatusPresentation(status);
  const Icon = view.iconName === "check" ? CheckCircle2 : view.iconName === "x" ? XCircle : view.iconName === "clock" ? Clock3 : view.iconName === "alert" ? AlertCircle : CircleDashed;
  return (
    <Badge variant="outline" className={cn("gap-1.5 rounded-full px-2.5 py-1 font-medium", reservationToneClasses(view.tone))}>
      <Icon className="size-3.5" aria-hidden="true" />
      {view.label}
    </Badge>
  );
}

export function StockLockBadge({ status }: { status: string }) {
  const view = stockLockPresentation(status);
  const Icon = view.iconName === "lock" ? LockKeyhole : view.iconName === "clock" ? Clock3 : LockKeyholeOpen;
  return (
    <Badge variant="outline" className={cn("gap-1.5 rounded-full px-2.5 py-1 font-medium", reservationToneClasses(view.tone))}>
      <Icon className="size-3.5" aria-hidden="true" />
      {view.label}
    </Badge>
  );
}
