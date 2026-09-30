import { ArrowRight, CircleDashed, Search, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function ModulePlaceholder({ title }: { title: string }) {
  return (
    <div className="space-y-5 pb-10">
      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">Visual foundation</Badge>
            <span className="text-xs text-muted-foreground">Data runtime belum diisi</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Struktur halaman sedang diselaraskan dengan design system Rental Outdoor.
          </p>
        </div>
        <Button className="shadow-sm"><ArrowRight className="size-4" />Aksi utama</Button>
      </section>

      <Card className="shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input aria-label={`Cari ${title}`} placeholder={`Cari ${title.toLowerCase()}...`} className="h-11 pl-9" />
            </div>
            <Button variant="outline" className="h-11"><SlidersHorizontal className="size-4" />Filter</Button>
            <Button variant="outline" className="h-11">Urutkan</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="min-h-[320px] shadow-sm">
        <CardHeader><CardTitle className="text-base">Ruang kerja {title}</CardTitle></CardHeader>
        <CardContent className="flex min-h-[240px] flex-col items-center justify-center text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><CircleDashed className="size-7" /></span>
          <h2 className="mt-4 text-base font-semibold">Template siap digunakan</h2>
          <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
            Belum ada data bisnis yang tersedia. UI sengaja menggunakan state kosong agar hierarchy, density, dan responsive behavior bisa dimatangkan terlebih dahulu.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

ModulePlaceholder.displayName = "ModulePlaceholder";
