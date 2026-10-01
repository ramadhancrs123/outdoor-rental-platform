import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, Handshake, PackageCheck, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  assignRentalUnit,
  completeRentalHandover,
  getRentalCapabilities,
  listAssignableUnits,
  reconcileRentalAssignment,
  reconcileRentalHandover,
} from "@/features/penyewaan";
import type { RentalAssignmentTarget, RentalDetail, RentalTenantContext } from "@/features/penyewaan";

type Feedback = { kind: "success" | "conflict" | "unknown" | "error"; message: string } | null;

function commandKey(prefix: string, id: string) {
  return `${prefix}-${id}-${crypto.randomUUID()}`;
}

function AssignmentTargetRow({
  context,
  target,
  rental,
  onChanged,
}: {
  context: RentalTenantContext;
  target: RentalAssignmentTarget;
  rental: RentalDetail;
  onChanged: () => Promise<unknown>;
}) {
  const [selectedUnit, setSelectedUnit] = useState("");
  const [note, setNote] = useState("");
  const commandRef = useRef<{ key: string; requestId: string } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const units = useQuery({
    queryKey: ["penyewaan", "assignable-units", context.usahaId, target.detail_penyewaan_id, target.komponen_penyewaan_id, rental.updated_at],
    queryFn: () => listAssignableUnits(context.usahaId, target.detail_penyewaan_id, target.komponen_penyewaan_id),
    enabled: target.assigned_quantity < target.required_quantity && rental.status !== "active",
    staleTime: 15_000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedUnit) throw new Error("Pilih unit terlebih dahulu.");
      if (!commandRef.current) {
        commandRef.current = {
          key: commandKey("assign-rental-unit", target.target_id),
          requestId: crypto.randomUUID(),
        };
      }
      return assignRentalUnit(context.usahaId, {
        penyewaanId: rental.penyewaan_id,
        detailPenyewaanId: target.detail_penyewaan_id,
        unitBarangId: selectedUnit,
        komponenPenyewaanId: target.komponen_penyewaan_id,
        alasanSubstitusi: null,
        catatan: note,
      }, commandRef.current);
    },
    onSuccess: async () => {
      commandRef.current = null;
      setSelectedUnit("");
      setNote("");
      setFeedback({ kind: "success", message: "Unit berhasil ditetapkan. Server sudah menyimpan fakta assignment dan auditnya." });
      await onChanged();
    },
    onError: async (error) => {
      const key = commandRef.current?.key;
      if (!key) {
        setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Penetapan unit gagal." });
        return;
      }
      try {
        const reconciliation = await reconcileRentalAssignment(context.usahaId, key);
        if (reconciliation.state === "committed") {
          commandRef.current = null;
          setSelectedUnit("");
          setFeedback({ kind: "success", message: "Request sempat tidak mendapat respons, tetapi server sudah melakukan assignment. Tidak ada retry otomatis." });
          await onChanged();
          return;
        }
        if (reconciliation.state === "not_found") {
          setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Penetapan unit belum berhasil. Anda dapat mencoba lagi dengan command baru." });
          commandRef.current = null;
          return;
        }
        setFeedback({ kind: "unknown", message: "Status penetapan unit belum dapat dipastikan. Periksa data penyewaan sebelum mencoba lagi." });
      } catch (reconciliationError) {
        setFeedback({ kind: "unknown", message: reconciliationError instanceof Error ? reconciliationError.message : "Rekonsiliasi assignment gagal." });
      }
    },
  });

  const complete = target.assigned_quantity >= target.required_quantity;
  return (
    <div className="rounded-2xl border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">{target.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">Required {target.required_quantity} · Assigned {target.assigned_quantity}</p>
        </div>
        {complete ? <Badge variant="secondary"><CheckCircle2 /> Lengkap</Badge> : <Badge variant="outline"><Clock3 /> Menunggu unit</Badge>}
      </div>
      {!complete && (
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Select value={selectedUnit} onValueChange={setSelectedUnit} disabled={units.isPending || mutation.isPending}>
            <SelectTrigger aria-label={`Pilih unit untuk ${target.label}`}>
              <SelectValue placeholder={units.isPending ? "Memuat unit siap…" : "Pilih unit ready"} />
            </SelectTrigger>
            <SelectContent>
              {(units.data ?? []).map((unit) => (
                <SelectItem key={unit.unit_barang_id} value={unit.unit_barang_id}>
                  {unit.kode_unit}{unit.serial_number ? ` · ${unit.serial_number}` : ""}
                </SelectItem>
              ))}
              {!units.isPending && (units.data ?? []).length === 0 && (
                <SelectItem value="__empty" disabled>Tidak ada unit ready yang cocok</SelectItem>
              )}
            </SelectContent>
          </Select>
          <input
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Catatan Penetapan Unit (opsional)"
            disabled={mutation.isPending}
            aria-label="Catatan Penetapan Unit"
          />
          <Button onClick={() => mutation.mutate()} disabled={!selectedUnit || mutation.isPending || units.isPending}>
            {mutation.isPending ? "Menyimpan…" : "Tetapkan Unit"}
          </Button>
        </div>
      )}
      {feedback && (
        <Alert className="mt-3" variant={feedback.kind === "error" || feedback.kind === "unknown" ? "destructive" : "default"}>
          {feedback.kind === "success" ? <CheckCircle2 /> : <AlertTriangle />}
          <AlertTitle>{feedback.kind === "unknown" ? "Status belum pasti" : feedback.kind === "success" ? "Penetapan Unit tersimpan" : "Penetapan Unit belum selesai"}</AlertTitle>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function RentalPhase2Actions({
  context,
  rental,
  onChanged,
}: {
  context: RentalTenantContext;
  rental: RentalDetail;
  onChanged: () => Promise<unknown>;
}) {
  const capabilities = getRentalCapabilities();
  const queryClient = useQueryClient();
  const [handoverNote, setHandoverNote] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const handoverRef = useRef<{ key: string; requestId: string } | null>(null);

  const targets: RentalAssignmentTarget[] = [
    ...rental.lines
      .filter((line) => !line.paket_sewa_id)
      .map((line) => ({
        target_id: line.detail_penyewaan_id,
        komponen_penyewaan_id: null,
        detail_penyewaan_id: line.detail_penyewaan_id,
        label: line.barang_nama ?? line.varian_nama ?? "Detail rental",
        required_quantity: Number(line.jumlah),
        assigned_quantity: rental.assignments.filter((assignment) =>
          assignment.status === "assigned" && assignment.detail_penyewaan_id === line.detail_penyewaan_id && !assignment.komponen_penyewaan_id
        ).length,
        barang_id: line.barang_id,
        varian_barang_id: line.varian_barang_id,
      })),
    ...rental.components.map((component) => ({
      target_id: component.komponen_penyewaan_id,
      komponen_penyewaan_id: component.komponen_penyewaan_id,
      detail_penyewaan_id: component.detail_penyewaan_id,
      label: component.barang_nama ?? component.varian_nama ?? "Komponen paket",
      required_quantity: Number(component.jumlah),
      assigned_quantity: rental.assignments.filter((assignment) =>
        assignment.status === "assigned" && assignment.komponen_penyewaan_id === component.komponen_penyewaan_id
      ).length,
      barang_id: component.barang_id,
      varian_barang_id: component.varian_barang_id,
    })),
  ];
  const assignmentComplete = targets.length > 0 && targets.every((target) => target.assigned_quantity >= target.required_quantity);

  const handoverMutation = useMutation({
    mutationFn: async () => {
      if (!handoverRef.current) {
        handoverRef.current = {
          key: commandKey("pickup-rental", rental.penyewaan_id),
          requestId: crypto.randomUUID(),
        };
      }
      return completeRentalHandover(context.usahaId, {
        penyewaanId: rental.penyewaan_id,
        serahTerimaAt: null,
        catatan: handoverNote,
      }, handoverRef.current);
    },
    onSuccess: async () => {
      handoverRef.current = null;
      setHandoverNote("");
      setFeedback({ kind: "success", message: "Serah-terima berhasil. Penyewaan sekarang aktif dan unit berubah menjadi Sedang Disewa melalui transaksi sistem." });
      await onChanged();
      await queryClient.invalidateQueries({ queryKey: ["penyewaan", "list"] });
    },
    onError: async (error) => {
      const key = handoverRef.current?.key;
      if (!key) {
        setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Serah-terima gagal." });
        return;
      }
      try {
        const reconciliation = await reconcileRentalHandover(context.usahaId, key);
        if (reconciliation.state === "committed") {
          handoverRef.current = null;
          setFeedback({ kind: "success", message: "Request tidak mendapat respons, tetapi server sudah menyelesaikan pickup. Tidak ada retry otomatis." });
          await onChanged();
          await queryClient.invalidateQueries({ queryKey: ["penyewaan", "list"] });
          return;
        }
        if (reconciliation.state === "not_found") {
          handoverRef.current = null;
          setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Serah-terima belum berhasil. Anda dapat mencoba lagi." });
          return;
        }
        setFeedback({ kind: "unknown", message: "Status serah-terima belum dapat dipastikan. Periksa detail penyewaan sebelum mencoba lagi." });
      } catch (reconciliationError) {
        setFeedback({ kind: "unknown", message: reconciliationError instanceof Error ? reconciliationError.message : "Rekonsiliasi pickup gagal." });
      }
    },
  });

  if (!capabilities.mutation) return null;
  const showHandover = rental.status === "draft" || rental.status === "ready_for_pickup";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><div><CardTitle className="text-base">Penetapan Unit</CardTitle><p className="text-sm text-muted-foreground">Tetapkan unit dari Inventaris, satu unit setiap tindakan.</p></div></div>
        </CardHeader>
        <CardContent className="space-y-3">
          {rental.status === "active" ? (
            <Alert><PackageCheck /><AlertTitle>Penetapan Unit sudah menjadi bagian dari penyewaan aktif</AlertTitle><AlertDescription>Serah-terima berhasil; penetapan unit tidak lagi dapat diubah pada tahap ini.</AlertDescription></Alert>
          ) : targets.length === 0 ? (
            <Alert variant="destructive"><AlertTitle>Unit yang akan ditetapkan belum tersedia</AlertTitle><AlertDescription>Sistem belum menyediakan detail unit fisik yang dapat ditetapkan untuk penyewaan ini.</AlertDescription></Alert>
          ) : (
            targets.map((target) => (
              <AssignmentTargetRow
                key={target.target_id}
                context={context}
                target={target}
                rental={rental}
                onChanged={onChanged}
              />
            ))
          )}
        </CardContent>
      </Card>

      {showHandover && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2"><Handshake className="size-5 text-primary" /><div><CardTitle className="text-base">Serah-terima</CardTitle><p className="text-sm text-muted-foreground">Serah-terima hanya dapat berhasil setelah seluruh jumlah unit terpenuhi dan unit masih siap disewakan. Waktu aktual dicatat otomatis oleh sistem.</p></div></div>
          </CardHeader>
          <CardContent className="space-y-3">
            {!assignmentComplete && <Alert><Clock3 /><AlertTitle>Menunggu penetapan unit lengkap</AlertTitle><AlertDescription>{targets.reduce((sum, target) => sum + Math.max(0, target.required_quantity - target.assigned_quantity), 0)} unit masih perlu ditetapkan.</AlertDescription></Alert>}
            <input
              className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={handoverNote}
              onChange={(event) => setHandoverNote(event.target.value)}
              placeholder="Catatan serah-terima (opsional)"
              disabled={!assignmentComplete || handoverMutation.isPending}
              aria-label="Catatan serah-terima"
            />
            <Button onClick={() => handoverMutation.mutate()} disabled={!assignmentComplete || handoverMutation.isPending}>
              <Handshake /> {handoverMutation.isPending ? "Menyelesaikan…" : "Selesaikan Serah-terima"}
            </Button>
            {feedback && (
              <Alert variant={feedback.kind === "error" || feedback.kind === "unknown" ? "destructive" : "default"}>
                {feedback.kind === "success" ? <CheckCircle2 /> : <AlertTriangle />}
                <AlertTitle>{feedback.kind === "unknown" ? "Status serah-terima belum pasti" : feedback.kind === "success" ? "Serah-terima tersimpan" : "Serah-terima belum selesai"}</AlertTitle>
                <AlertDescription>{feedback.message}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
