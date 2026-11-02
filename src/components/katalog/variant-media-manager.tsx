import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Star, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  removeCatalogVariantMedia,
  setCatalogVariantMediaCover,
  uploadCatalogVariantMediaFile,
} from "@/features/katalog";
import type { CatalogVariantMedia } from "@/features/katalog/types";

type Props = {
  usahaId: string;
  variantId: string;
  media: CatalogVariantMedia[];
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Pengelolaan foto varian gagal.";
}

export function VariantMediaManager({ usahaId, variantId, media }: Props) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["katalog", "product"] }),
      queryClient.invalidateQueries({ queryKey: ["katalog", "variants"] }),
    ]);
  };

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Pilih foto varian terlebih dahulu.");
      return uploadCatalogVariantMediaFile(usahaId, variantId, file, {
        isCover: media.length === 0,
        urutan: media.length + 1,
      });
    },
    onSuccess: async () => {
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      toast.success("Foto varian berhasil disimpan. Foto ini digunakan bersama seluruh unit varian.");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const coverMutation = useMutation({
    mutationFn: (item: CatalogVariantMedia) => setCatalogVariantMediaCover(usahaId, item.varian_barang_media_id, true),
    onSuccess: async () => {
      toast.success("Foto utama varian diperbarui.");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const removeMutation = useMutation({
    mutationFn: (item: CatalogVariantMedia) => removeCatalogVariantMedia(usahaId, item.varian_barang_media_id),
    onSuccess: async () => {
      toast.success("Foto varian dihapus.");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const busy = uploadMutation.isPending || coverMutation.isPending || removeMutation.isPending;

  return (
    <section className="space-y-3 rounded-2xl border border-primary/15 bg-primary/[0.025] p-3 sm:p-4" aria-label="Foto representatif varian">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ImagePlus className="size-4 text-primary" />
            Foto Varian
            <Badge variant="secondary" className="rounded-full text-[10px]">Dipakai bersama</Badge>
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Foto representatif ini otomatis tampil pada seluruh unit varian. Foto fisik tiap unit tetap dikelola terpisah.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-9 shrink-0 rounded-xl" onClick={() => inputRef.current?.click()} disabled={busy}>
          <ImagePlus className="size-4" />Pilih Foto
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          aria-label="Pilih foto varian"
        />
      </div>

      {file ? (
        <div className="grid gap-3 rounded-xl border bg-background p-2.5 sm:grid-cols-[88px_minmax(0,1fr)_auto] sm:items-center">
          {preview ? <img src={preview} alt="Pratinjau foto varian" className="size-[88px] rounded-lg object-cover" /> : null}
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{file.name}</p>
            <p className="text-[11px] text-muted-foreground">{Math.max(1, Math.round(file.size / 1024))} KB · Maksimal 8 MB</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" className="h-9 flex-1 rounded-xl sm:flex-none" onClick={() => uploadMutation.mutate()} disabled={busy}>
              {uploadMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}Simpan
            </Button>
            <Button type="button" size="icon" variant="ghost" className="size-9 rounded-xl" aria-label="Batalkan foto" onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = ""; }} disabled={busy}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {media.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {media.map((item, index) => (
            <div key={item.varian_barang_media_id} className="overflow-hidden rounded-xl border bg-background">
              <div className="relative aspect-[4/3] bg-muted">
                {item.url ? <img src={item.url} alt={"Foto varian " + (index + 1)} className="size-full object-cover" /> : null}
                {item.is_cover ? <Badge className="absolute left-2 top-2 rounded-full text-[10px]">Utama</Badge> : null}
              </div>
              <div className="flex items-center justify-between gap-1 p-1.5">
                <Button type="button" size="sm" variant="ghost" className="h-8 min-w-0 flex-1 rounded-lg px-1.5 text-[10px]" onClick={() => coverMutation.mutate(item)} disabled={busy || item.is_cover}>
                  {coverMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <Star className="size-3" />}
                  {item.is_cover ? "Foto utama" : "Jadikan utama"}
                </Button>
                <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0 rounded-lg text-destructive" aria-label="Hapus foto varian" onClick={() => { if (window.confirm("Hapus foto varian ini?")) removeMutation.mutate(item); }} disabled={busy}>
                  {removeMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed bg-background/70 px-3 py-4 text-center text-xs text-muted-foreground">
          Belum ada foto varian. Tambahkan foto agar seluruh unit dapat menggunakan gambar yang sama.
        </div>
      )}
    </section>
  );
}
