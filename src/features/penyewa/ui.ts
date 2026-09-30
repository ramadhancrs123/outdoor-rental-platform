export function renterStatusLabel(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "all") return "Semua";
  if (normalized === "active") return "Aktif";
  if (normalized === "inactive" || normalized === "non-active" || normalized === "nonaktif") return "Non-aktif";
  return status;
}

export function renterStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const normalized = status.toLowerCase();
  if (normalized === "active") return "default";
  if (normalized === "inactive" || normalized === "non-active" || normalized === "nonaktif") return "secondary";
  return "outline";
}

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "P";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
