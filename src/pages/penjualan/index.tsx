import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowRight, CheckCircle2, CreditCard, Package, PackagePlus, Plus, Printer, RefreshCw, Search, ShoppingCart, Trash2, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getKeuanganContext, listFinanceAccounts, type FinanceAccount } from "@/features/keuangan";
import { adjustSaleStock, createQuickSaleProduct, createSale, getSaleReceiptData, listSaleCatalogItems, listSales } from "@/features/penjualan";
import { listCatalogCategories } from "@/features/katalog/service";
import type { SaleCatalogItem, SaleCartLine, SalePaymentMethod, SaleReceiptData } from "@/features/penjualan";
import { buildSaleReceiptThermalHtml } from "@/features/penjualan/receipt";
import { printHtmlDocument } from "@/features/qr-operasional/print";
import { createClientId } from "@/lib/client-id";
import { paths } from "@/routes/paths";
import { cn } from "@/lib/utils";
import { listRenters, type RenterListItem } from "@/features/penyewa/service";

function money(value: number) {
  return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(value);
}
function messageOf(error: unknown,fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function PenjualanPage() {
  const queryClient=useQueryClient();
  const [search,setSearch]=useState("");
  const [categoryId,setCategoryId]=useState("all");
  const [cart,setCart]=useState<Record<string,{item:SaleCatalogItem;jumlah:number}>>({});
  const [selectedRenter,setSelectedRenter]=useState<RenterListItem|null>(null);
  const [renterSearch,setRenterSearch]=useState("");
  const [renterPickerOpen,setRenterPickerOpen]=useState(false);
  const [checkoutOpen,setCheckoutOpen]=useState(false);
  const [paymentMethod,setPaymentMethod]=useState<SalePaymentMethod>("cash");
  const [accountId,setAccountId]=useState("");
  const [idempotencyKey,setIdempotencyKey]=useState(()=>createClientId());
  const [completedSaleId,setCompletedSaleId]=useState("");
  const [stockItem,setStockItem]=useState<SaleCatalogItem|null>(null);
  const [stockQuantity,setStockQuantity]=useState("");
  const [stockReason,setStockReason]=useState("");
  const [stockIdempotencyKey,setStockIdempotencyKey]=useState(()=>createClientId());
  const [receiptError,setReceiptError]=useState("");
  const [quickProductOpen,setQuickProductOpen]=useState(false);
  const [quickProduct,setQuickProduct]=useState({kategoriId:"",nama:"",satuan:"pcs",hargaBeli:"",hargaJual:""});
  const [quickProductKey,setQuickProductKey]=useState(()=>createClientId());

  const context=useQuery({queryKey:["keuangan","context"],queryFn:getKeuanganContext,staleTime:60_000});
  const products=useQuery<SaleCatalogItem[],Error>({
    queryKey:["penjualan","catalog",context.data?.usahaId],
    queryFn:()=>listSaleCatalogItems(context.data!.usahaId),
    enabled:Boolean(context.data?.usahaId),
    staleTime:10_000,
  });
  const categoriesQuery=useQuery({
    queryKey:["katalog","categories",context.data?.usahaId],
    queryFn:()=>listCatalogCategories(context.data!.usahaId),
    enabled:Boolean(context.data?.usahaId),
    staleTime:60_000,
  });
  const accounts=useQuery<FinanceAccount[]>({
    queryKey:["keuangan","accounts",context.data?.usahaId],
    queryFn:()=>listFinanceAccounts(context.data!.usahaId),
    enabled:Boolean(context.data?.usahaId),
    staleTime:30_000,
  });
  const defaultCashAccount=useMemo(()=>{
    const available=accounts.data??[];
    return available.find((account)=>account.nama_akun.trim().toLocaleLowerCase("id-ID")==="kas operasional")
      ??available.find((account)=>account.jenis_akun==="kas")
      ??available[0]
      ??null;
  },[accounts.data]);

  useEffect(()=>{
    if(defaultCashAccount&&(!accountId||!(accounts.data??[]).some((account)=>account.akun_keuangan_id===accountId))){
      setAccountId(defaultCashAccount.akun_keuangan_id);
    }
  },[accountId,accounts.data,defaultCashAccount]);

  const renters=useQuery<RenterListItem[],Error>({
    queryKey:["penyewa","pos-picker",context.data?.usahaId,renterSearch],
    queryFn:()=>listRenters({
      akunAdminId:context.data!.akunAdminId,
      usahaId:context.data!.usahaId,
      usahaNama:context.data!.usahaNama,
    },renterSearch,"active"),
    enabled:Boolean(context.data?.usahaId&&renterPickerOpen),
    staleTime:30_000,
  });

  const history=useQuery({
    queryKey:["penjualan","history",context.data?.usahaId],
    queryFn:()=>listSales(context.data!.usahaId,"",8),
    enabled:Boolean(context.data?.usahaId),
    staleTime:10_000,
  });
  const receipt=useQuery<SaleReceiptData>({
    queryKey:["penjualan","receipt",context.data?.usahaId,completedSaleId],
    queryFn:()=>getSaleReceiptData(context.data!.usahaId,completedSaleId),
    enabled:Boolean(context.data?.usahaId&&completedSaleId),
    staleTime:60_000,
  });

  const items=useMemo(()=>products.data??[],[products.data]);
  const categories=useMemo(()=>Array.from(new Map(items.map(item=>[item.kategori_barang_id,{id:item.kategori_barang_id,nama:item.kategori_nama}])).values()).sort((a,b)=>a.nama.localeCompare(b.nama,"id")),[items]);
  const filteredItems=useMemo(()=>{
    const term=search.trim().toLowerCase();
    return items.filter(item=>(categoryId==="all"||item.kategori_barang_id===categoryId)&&(!term||item.nama.toLowerCase().includes(term)||item.kategori_nama.toLowerCase().includes(term)));
  },[items,search,categoryId]);
  const cartLines=Object.values(cart).map(({item,jumlah}):SaleCartLine=>({
    barang_id:item.barang_id,varian_barang_id:item.varian_barang_id,nama:item.nama_barang,
    nama_varian:item.nama_varian,jumlah,unit_price:item.harga_jual??0,
    subtotal:(item.harga_jual??0)*jumlah,inventory_mode:item.inventory_mode,
    available_stock:item.available_stock,satuan_jual:item.satuan_jual,
  }));
  const total=cartLines.reduce((sum,line)=>sum+line.subtotal,0);
  const paymentAccount=(accounts.data??[]).find(account=>account.akun_keuangan_id===accountId)??null;
  const stockAvailable=stockItem?.available_stock??0;

  const addItem=(item:SaleCatalogItem)=>{
    if(item.harga_jual==null||item.harga_jual<=0) return toast.error("Harga jual produk belum diatur pada katalog.");
    if(item.available_stock!==null && item.available_stock<=0) return toast.error("Stok produk belum tersedia.");
    setCart(current=>{
      const existing=current[item.key];
      if(existing&&item.available_stock!==null&&existing.jumlah>=item.available_stock) {
        toast.warning("Jumlah telah mencapai stok yang tersedia.");
        return current;
      }
      return {...current,[item.key]:{item,jumlah:(existing?.jumlah??0)+1}};
    });
  };
  const setQuantity=(key:string,delta:number)=>{
    setCart(current=>{
      const line=current[key];
      if(!line) return current;
      const next=line.jumlah+delta;
      if(next<=0) {
        const copy={...current}; delete copy[key]; return copy;
      }
      if(line.item.available_stock!==null&&next>line.item.available_stock) {
        toast.warning("Jumlah melebihi stok yang tersedia.");
        return current;
      }
      return {...current,[key]:{...line,jumlah:next}};
    });
  };

  const checkout=useMutation({
    mutationFn:async()=>{
      if(!context.data) throw new Error("Usaha aktif belum tersedia.");
      if(!cartLines.length) throw new Error("Tambahkan minimal satu barang.");
      if(!accountId) throw new Error("Pilih akun penerima pembayaran.");
      return createSale(context.data.usahaId,{
        penyewaId:selectedRenter?.penyewa_id??null,
        namaPelanggan:selectedRenter?.nama_lengkap??null,
        nomorTelepon:selectedRenter?.nomor_telepon??null,
        lines:cartLines.map(line=>({barang_id:line.barang_id,varian_barang_id:line.varian_barang_id,jumlah:line.jumlah})),
        akunKeuanganId:accountId,
        metode:paymentMethod,
      },{idempotencyKey,requestId:createClientId()});
    },
    onSuccess:async result=>{
      setCompletedSaleId(result.penjualan_id);
      setCart({});
      setSelectedRenter(null);
      setRenterPickerOpen(false);
      setCheckoutOpen(false);
      setIdempotencyKey(createClientId());
      setReceiptError("");
      await Promise.all([
        queryClient.invalidateQueries({queryKey:["penjualan","catalog",context.data?.usahaId]}),
        queryClient.invalidateQueries({queryKey:["penjualan","history",context.data?.usahaId]}),
        queryClient.invalidateQueries({queryKey:["inventaris"]}),
        queryClient.invalidateQueries({queryKey:["keuangan"]}),
      ]);
      toast.success("Penjualan berhasil diselesaikan.");
    },
    onError:error=>toast.error(messageOf(error,"Checkout penjualan gagal.")),
  });

  const createQuickProduct=useMutation({
    mutationFn:async()=>{
      if(!context.data) throw new Error("Usaha aktif belum tersedia.");
      const hargaBeli=Number(quickProduct.hargaBeli);
      const hargaJual=Number(quickProduct.hargaJual);
      if(!quickProduct.kategoriId) throw new Error("Pilih kategori barang.");
      if(quickProduct.nama.trim().length<2) throw new Error("Nama barang minimal 2 karakter.");
      if(!Number.isFinite(hargaBeli)||hargaBeli<0) throw new Error("Harga beli wajib diisi nol atau lebih.");
      if(!Number.isFinite(hargaJual)||hargaJual<=0) throw new Error("Harga jual harus lebih besar dari nol.");
      return createQuickSaleProduct(context.data.usahaId,{
        kategoriBarangId:quickProduct.kategoriId,nama:quickProduct.nama,
        satuanJual:quickProduct.satuan,hargaBeli,hargaJual,
      },{idempotencyKey:quickProductKey,requestId:createClientId()});
    },
    onSuccess:async(result)=>{
      setQuickProductOpen(false);
      setQuickProduct({kategoriId:"",nama:"",satuan:"pcs",hargaBeli:"",hargaJual:""});
      setQuickProductKey(createClientId());
      const refreshed=await products.refetch();
      const createdItem=refreshed.data?.find(item=>item.barang_id===result.barang_id&&item.varian_barang_id===null);
      if(createdItem) addItem(createdItem);
      await queryClient.invalidateQueries({queryKey:["katalog"]});
      toast.success(createdItem?"Barang dibuat dan ditambahkan ke keranjang.":"Barang berhasil dibuat. Silakan pilih dari katalog.");
    },
    onError:error=>toast.error(messageOf(error,"Barang gagal dibuat.")),
  });

  const adjustStock=useMutation({
    mutationFn:async()=>{
      if(!context.data||!stockItem) throw new Error("Produk stok belum dipilih.");
      const value=Number(stockQuantity);
      if(!Number.isInteger(value)||value<0) throw new Error("Jumlah stok harus berupa bilangan bulat nol atau lebih.");
      if(stockReason.trim().length<5) throw new Error("Alasan penyesuaian minimal 5 karakter.");
      return adjustSaleStock(context.data.usahaId,{
        barangId:stockItem.barang_id,varianBarangId:stockItem.varian_barang_id,
        jumlahBaru:value,alasan:stockReason,
      },{idempotencyKey:stockIdempotencyKey,requestId:createClientId()});
    },
    onSuccess:async()=>{
      setStockItem(null);setStockQuantity("");setStockReason("");setStockIdempotencyKey(createClientId());
      await queryClient.invalidateQueries({queryKey:["penjualan","catalog",context.data?.usahaId]});
      toast.success("Saldo stok diperbarui dan riwayat mutasinya tercatat.");
    },
    onError:error=>toast.error(messageOf(error,"Penyesuaian stok gagal.")),
  });

  const printReceipt=async()=>{
    if(!receipt.data) return;
    try {
      await printHtmlDocument(buildSaleReceiptThermalHtml(receipt.data),{
        androidThermal:true,
        documentName:"struk-"+receipt.data.nomor_checkout+"-58mm",
      });
    } catch(error) {
      setReceiptError(messageOf(error,"Struk gagal disiapkan untuk dicetak."));
    }
  };

  if(context.isPending||products.isPending||accounts.isPending) return <div className="mx-auto max-w-7xl space-y-3"><Skeleton className="h-20 rounded-2xl"/><Skeleton className="h-96 rounded-2xl"/></div>;
  if(context.error||products.error||accounts.error) return <Alert variant="destructive"><AlertTitle>Halaman penjualan belum tersedia</AlertTitle><AlertDescription>{messageOf(context.error??products.error??accounts.error,"Data penjualan gagal dimuat.")}</AlertDescription></Alert>;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 pb-28">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Point of Sale</p><h1 className="text-2xl font-bold tracking-tight">Penjualan</h1><p className="mt-1 text-xs text-muted-foreground">Katalog visual, keranjang, dan checkout cepat untuk barang yang dibeli pelanggan.</p></div>
        <Button asChild variant="outline" className="h-9 rounded-xl"><Link to={paths.katalog}>Atur katalog<ArrowRight className="size-4"/></Link></Button>
      </header>

      {completedSaleId ? (
        <Card className="rounded-2xl border-emerald-300/70 bg-emerald-50/40 dark:bg-emerald-950/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white"><CheckCircle2 className="size-5"/></span><div className="min-w-0"><p className="text-sm font-bold">Penjualan berhasil</p><p className="text-xs text-muted-foreground">{receipt.data?.nomor_penjualan??"Transaksi tersimpan"} · {receipt.data?.nomor_checkout??"Menyiapkan struk"}</p>{receipt.data?(receipt.data.gross_profit===null?<p className="mt-1 text-[11px] text-muted-foreground">HPP belum lengkap — margin belum dapat dihitung.</p>:<p className="mt-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Margin kotor {money(receipt.data.gross_profit)} · HPP {money(receipt.data.total_hpp??0)}</p>):null}</div></div>
            <div className="flex gap-2"><Button variant="outline" size="sm" className="rounded-xl" onClick={()=>setCompletedSaleId("")}>Tutup</Button><Button size="sm" className="rounded-xl" disabled={!receipt.data||receipt.isPending} onClick={()=>void printReceipt()}><Printer className="size-4"/>Cetak 58 mm</Button></div>
          </CardContent>
          {receiptError?<CardContent className="pt-0"><Alert variant="destructive"><AlertDescription>{receiptError}</AlertDescription></Alert></CardContent>:null}
          {receipt.error?<CardContent className="pt-0"><Alert variant="destructive"><AlertDescription>{messageOf(receipt.error,"Data struk belum dapat dimuat.")}</AlertDescription></Alert></CardContent>:null}
        </Card>
      ):null}

      <section className="min-w-0 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border bg-card px-3"><Search className="size-4 shrink-0 text-muted-foreground"/><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari produk atau kategori…" className="h-11 border-0 shadow-none focus-visible:ring-0"/></div>
          <Button className="h-11 shrink-0 rounded-xl" onClick={()=>setQuickProductOpen(true)}><PackagePlus className="size-4"/>Tambah Barang</Button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Button size="sm" variant={categoryId==="all"?"default":"outline"} className="h-8 shrink-0 rounded-full" onClick={()=>setCategoryId("all")}>Semua</Button>
          {categories.map(category=><Button key={category.id} size="sm" variant={categoryId===category.id?"default":"outline"} className="h-8 shrink-0 rounded-full" onClick={()=>setCategoryId(category.id)}>{category.nama}</Button>)}
        </div>
        {filteredItems.length?(
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {filteredItems.map(item=>(
              <Card key={item.key} className="overflow-hidden rounded-2xl shadow-none">
                <div className="relative aspect-[4/3] bg-muted/50">
                  {item.cover_url?<img src={item.cover_url} alt="" loading="lazy" className="size-full object-cover"/>:<div className="grid size-full place-items-center text-muted-foreground"><Package className="size-9"/></div>}
                  <Badge className="absolute left-2 top-2 rounded-full bg-background/90 text-foreground hover:bg-background/90">{item.inventory_mode==="quantity"?"Stok terpantau":item.inventory_mode==="untracked"?"Tanpa stok":"Unit fisik"}</Badge>
                  {cart[item.key]?<Badge className="absolute right-2 top-2 rounded-full">{cart[item.key].jumlah} di keranjang</Badge>:null}
                </div>
                <CardContent className="space-y-2 p-2.5">
                  <div className="min-w-0"><p className="truncate text-[11px] font-bold">{item.nama}</p><p className="truncate text-[9px] text-muted-foreground">{item.kategori_nama}</p></div>
                  <div className="flex items-center justify-between gap-2"><span className="text-[9px] text-muted-foreground">{item.available_stock===null?"Tidak dilacak":"Stok "+item.available_stock}</span><span className="text-[10px] font-bold text-primary">{item.harga_jual!=null?money(item.harga_jual):"Harga belum diatur"}</span></div>
                  <div className="grid grid-cols-1 gap-1.5">
                    <Button size="sm" className="h-8 rounded-lg text-[10px]" disabled={(item.available_stock!==null&&item.available_stock<=0)||item.harga_jual==null||item.harga_jual<=0} onClick={()=>addItem(item)}><Plus className="size-3.5"/>{cart[item.key]?"Tambah lagi":"Tambah ke keranjang"}</Button>
                    {item.inventory_mode==="quantity"?<Button size="sm" variant="ghost" className="h-7 rounded-lg text-[9px]" onClick={()=>{setStockItem(item);setStockQuantity(String(item.available_stock??0));setStockReason("");}}>Atur stok</Button>:null}
                    {(item.harga_jual==null||item.harga_jual<=0)?<Button asChild size="sm" variant="ghost" className="h-7 rounded-lg text-[9px]"><Link to={paths.katalogEdit+"/"+item.barang_id}>Atur harga</Link></Button>:null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ):(
          <div className="rounded-2xl border border-dashed p-12 text-center"><Package className="mx-auto size-8 text-muted-foreground"/><p className="mt-3 text-sm font-semibold">Belum ada produk yang dapat dijual</p><p className="mt-1 text-xs text-muted-foreground">Aktifkan channel Jual dan isi harga serta stok melalui katalog.</p><Button asChild variant="outline" size="sm" className="mt-4 rounded-xl"><Link to={paths.katalog}>Buka katalog</Link></Button></div>
        )}
      </section>

      {cartLines.length>0?(
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.65rem)] shadow-[0_-8px_28px_rgba(15,23,42,.08)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-3">
            <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold text-muted-foreground">{cartLines.reduce((sum,line)=>sum+line.jumlah,0)} item · {cartLines.length} jenis barang</p><p className="truncate text-base font-black tracking-tight">{money(total)}</p></div>
            <Button className="h-11 shrink-0 rounded-xl px-5" onClick={()=>setCheckoutOpen(true)}><ShoppingCart className="size-4"/>Periksa Keranjang<ArrowRight className="size-4"/></Button>
          </div>
        </div>
      ):null}

      <Dialog open={checkoutOpen} onOpenChange={(open)=>{if(!checkout.isPending)setCheckoutOpen(open);}}>
        <DialogContent className="max-h-[92dvh] w-[calc(100%-1rem)] max-w-2xl overflow-y-auto rounded-2xl p-0 sm:w-full">
          <DialogHeader className="border-b px-4 py-3 pr-12 text-left sm:px-5">
            <DialogTitle className="flex items-center gap-2 text-base"><ShoppingCart className="size-4 text-primary"/>Verifikasi Penjualan</DialogTitle>
            <DialogDescription className="text-xs">Periksa barang dan pembayaran sebelum transaksi disimpan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-4 py-3 sm:px-5">
            <section className="space-y-2">
              <div className="flex items-center justify-between"><h3 className="text-xs font-bold">Barang yang dibeli</h3><Badge variant="secondary" className="rounded-full">{cartLines.reduce((sum,line)=>sum+line.jumlah,0)} item</Badge></div>
              {cartLines.length?cartLines.map(line=>{
                const key=line.varian_barang_id??line.barang_id;
                return <div key={key} className="flex items-center gap-2 rounded-xl border p-2.5">
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{line.nama}</p>{line.nama_varian?<p className="truncate text-[10px] text-muted-foreground">{line.nama_varian}</p>:null}<p className="mt-0.5 text-[10px] text-muted-foreground">{money(line.unit_price)} / {line.satuan_jual??"unit"}</p></div>
                  <div className="flex shrink-0 items-center gap-1"><Button size="icon" variant="outline" aria-label={"Kurangi "+line.nama} className="size-7 rounded-lg" onClick={()=>setQuantity(key,-1)}>−</Button><span className="min-w-5 text-center text-xs font-bold">{line.jumlah}</span><Button size="icon" variant="outline" aria-label={"Tambah "+line.nama} className="size-7 rounded-lg" onClick={()=>setQuantity(key,1)} disabled={line.available_stock!==null&&line.jumlah>=line.available_stock}>+</Button><Button size="icon" variant="ghost" aria-label={"Hapus "+line.nama} className="size-7 rounded-lg text-destructive" onClick={()=>setCart(current=>{const copy={...current};delete copy[key];return copy;})}><Trash2 className="size-3.5"/></Button></div>
                  <strong className="w-24 shrink-0 text-right text-xs tabular-nums">{money(line.subtotal)}</strong>
                </div>;
              }):<p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">Keranjang kosong.</p>}
              <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2.5"><span className="text-xs font-medium text-muted-foreground">Total pembelian</span><strong className="text-base tabular-nums">{money(total)}</strong></div>
            </section>

            <section className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between gap-2"><div><h3 className="text-xs font-bold">Pelanggan</h3><p className="text-[10px] text-muted-foreground">Opsional · tanpa pilihan akan tercatat sebagai Pelanggan Umum.</p></div><Button size="sm" variant="outline" className="h-8 rounded-lg text-[10px]" onClick={()=>setRenterPickerOpen(value=>!value)}>{renterPickerOpen?"Tutup daftar":"Pilih penyewa"}</Button></div>
              {selectedRenter?(
                <div className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.035] p-2.5">
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{selectedRenter.nama_lengkap}</p><p className="text-[10px] text-muted-foreground">{selectedRenter.nomor_telepon}</p></div><Badge variant="secondary" className="rounded-full">Terdaftar</Badge><Button size="sm" variant="ghost" className="h-7 rounded-lg text-[10px]" onClick={()=>setSelectedRenter(null)}>Hapus</Button>
                </div>
              ):<div className="rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground">Pelanggan Umum</div>}
              {renterPickerOpen?(
                <div className="space-y-2 rounded-xl border bg-muted/15 p-2.5">
                  <Input value={renterSearch} onChange={event=>setRenterSearch(event.target.value)} placeholder="Cari nama atau nomor telepon penyewa…" className="h-9 rounded-lg text-xs"/>
                  <div className="max-h-36 space-y-1 overflow-y-auto">
                    {renters.isPending?<p className="p-3 text-center text-[10px] text-muted-foreground">Memuat penyewa…</p>
                    :renters.error?<Alert variant="destructive"><AlertDescription>{messageOf(renters.error,"Daftar penyewa gagal dimuat.")}</AlertDescription></Alert>
                    :(renters.data??[]).map(renter=><button type="button" key={renter.penyewa_id} onClick={()=>{setSelectedRenter(renter);setRenterPickerOpen(false);setRenterSearch("");}} className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-background",selectedRenter?.penyewa_id===renter.penyewa_id?"bg-background ring-1 ring-primary/30":"")}>
                      <span className="min-w-0"><span className="block truncate text-xs font-semibold">{renter.nama_lengkap}</span><span className="block truncate text-[10px] text-muted-foreground">{renter.nomor_telepon}</span></span><span className="text-[9px] text-muted-foreground">{renter.status_verifikasi??"Belum diverifikasi"}</span>
                    </button>)}
                    {!renters.isPending&&!renters.error&&(renters.data??[]).length===0?<p className="p-3 text-center text-[10px] text-muted-foreground">Penyewa tidak ditemukan.</p>:null}
                  </div>
                </div>
              ):null}
            </section>

            <section className="grid gap-2 border-t pt-3 sm:grid-cols-2">
              <div className="space-y-1"><p className="text-[10px] font-semibold text-muted-foreground">Uang diterima ke</p><div className="flex h-10 items-center gap-2 rounded-xl border bg-muted/30 px-3"><WalletCards className="size-4 text-primary"/><span className="truncate text-xs font-semibold">{paymentAccount?.nama_akun??"Memuat Kas Operasional…"}</span><Badge variant="secondary" className="ml-auto rounded-full text-[9px]">Otomatis</Badge></div></div>
              <label className="grid gap-1 text-[10px] font-semibold">Metode pembayaran<Select value={paymentMethod} onValueChange={value=>setPaymentMethod(value as SalePaymentMethod)}><SelectTrigger className="h-10 rounded-xl text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="cash">Tunai</SelectItem><SelectItem value="bank_transfer">Transfer Bank</SelectItem><SelectItem value="qris_manual">QRIS</SelectItem><SelectItem value="other">Lainnya</SelectItem></SelectContent></Select></label>
            </section>
            {checkout.error?<Alert variant="destructive"><AlertDescription>{messageOf(checkout.error,"Checkout gagal.")}</AlertDescription></Alert>:null}
          </div>
          <DialogFooter className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur sm:px-5">
            <Button type="button" variant="outline" className="h-10 rounded-xl" disabled={checkout.isPending} onClick={()=>setCheckoutOpen(false)}>Kembali</Button>
            <Button type="button" className="h-10 flex-1 rounded-xl sm:flex-none" disabled={!cartLines.length||!accountId||total<=0||checkout.isPending} onClick={()=>checkout.mutate()}>{checkout.isPending?<><RefreshCw className="size-4 animate-spin"/>Memproses…</>:<><CreditCard className="size-4"/>Lanjut Penjualan · {money(total)}</>}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <section className="space-y-2">
        <div className="flex items-center justify-between"><h2 className="text-sm font-bold">Penjualan terbaru</h2><Button variant="ghost" size="sm" className="h-8 text-[10px]" onClick={()=>void history.refetch()}><RefreshCw className="size-3.5"/>Muat ulang</Button></div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {(history.data??[]).map(sale=><Card key={sale.penjualan_id} className="rounded-xl shadow-none"><CardContent className="flex items-center justify-between gap-2 p-3"><div className="min-w-0"><p className="truncate text-[11px] font-bold">{sale.nomor_penjualan}</p><p className="mt-0.5 truncate text-[9px] text-muted-foreground">{sale.nama_pelanggan??"Pelanggan Umum"} · {new Intl.DateTimeFormat("id-ID",{dateStyle:"short",timeStyle:"short"}).format(new Date(sale.created_at))}</p><p className="mt-1 text-[11px] font-bold">{money(Number(sale.total_amount))}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{sale.gross_profit===null?"HPP belum lengkap":"Margin kotor "+money(sale.gross_profit)}</p></div><Badge variant={sale.payment_status==="paid"?"default":"secondary"} className="rounded-full">{sale.payment_status==="paid"?"Lunas":"Belum Lunas"}</Badge></CardContent></Card>)}
        </div>
      </section>

      <Dialog open={quickProductOpen} onOpenChange={open=>{if(!createQuickProduct.isPending)setQuickProductOpen(open);}}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Tambah barang cepat</DialogTitle>
            <DialogDescription>Daftarkan barang jual tanpa pencatatan stok. Harga pokok disimpan untuk menghitung margin setiap transaksi.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold sm:col-span-2">Kategori
              <Select value={quickProduct.kategoriId} onValueChange={value=>setQuickProduct(v=>({...v,kategoriId:value}))}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Pilih kategori"/></SelectTrigger>
                <SelectContent>{(categoriesQuery.data??[]).filter(category=>category.status==="active").map(category=><SelectItem key={category.kategori_barang_id} value={category.kategori_barang_id}>{category.nama}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold sm:col-span-2">Nama barang
              <Input autoFocus className="h-10 rounded-xl" value={quickProduct.nama} onChange={e=>setQuickProduct(v=>({...v,nama:e.target.value}))} placeholder="Contoh: Gas refill, baterai, jas hujan"/>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold">Satuan jual
              <Input className="h-10 rounded-xl" value={quickProduct.satuan} onChange={e=>setQuickProduct(v=>({...v,satuan:e.target.value}))} placeholder="pcs, tabung, isi ulang" maxLength={20}/>
            </label>
            <div className="hidden sm:block"/>
            <label className="grid gap-1.5 text-xs font-semibold">Harga beli / HPP (IDR)
              <Input className="h-10 rounded-xl" type="number" min="0" step="1" inputMode="decimal" value={quickProduct.hargaBeli} onChange={e=>setQuickProduct(v=>({...v,hargaBeli:e.target.value}))} placeholder="Modal per unit"/>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold">Harga jual (IDR)
              <Input className="h-10 rounded-xl" type="number" min="1" step="1" inputMode="decimal" value={quickProduct.hargaJual} onChange={e=>setQuickProduct(v=>({...v,hargaJual:e.target.value}))} placeholder="Harga ke pelanggan"/>
            </label>
            {quickProduct.hargaBeli!==""&&quickProduct.hargaJual!==""&&Number.isFinite(Number(quickProduct.hargaBeli))&&Number.isFinite(Number(quickProduct.hargaJual))?(
              <div className="sm:col-span-2 rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">Estimasi margin kotor per {quickProduct.satuan||"unit"}</span><strong className={Number(quickProduct.hargaJual)-Number(quickProduct.hargaBeli)>=0?"text-emerald-600":"text-destructive"}>{money(Number(quickProduct.hargaJual)-Number(quickProduct.hargaBeli))}</strong></div>
                <p className="mt-1 text-[10px] text-muted-foreground">Dihitung dari harga jual dikurangi HPP. Uang penjualan penuh masuk ke akun kas/bank yang dipilih saat checkout.</p>
              </div>
            ):null}
            <div className="sm:col-span-2 flex items-start gap-2 rounded-xl border border-dashed p-3 text-[11px] leading-5 text-muted-foreground"><Package className="mt-0.5 size-4 shrink-0"/><span>Mode inventaris: <strong className="text-foreground">Tanpa pelacakan stok</strong>. Barang langsung dapat dijual; tidak mengurangi stok dan tidak mengganggu unit rental.</span></div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="rounded-xl" disabled={createQuickProduct.isPending} onClick={()=>setQuickProductOpen(false)}>Batal</Button>
            <Button className="rounded-xl" disabled={createQuickProduct.isPending||!quickProduct.kategoriId||!quickProduct.nama.trim()||quickProduct.hargaBeli===""||quickProduct.hargaJual===""} onClick={()=>createQuickProduct.mutate()}>{createQuickProduct.isPending?<RefreshCw className="size-4 animate-spin"/>:<Plus className="size-4"/>}Simpan & Tambah ke Keranjang</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {stockItem?(
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-3" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setStockItem(null);}}>
          <Card className="w-full max-w-md rounded-2xl"><CardHeader><CardTitle className="text-base">Penyesuaian Stok</CardTitle><p className="text-xs text-muted-foreground">{stockItem.nama} · Stok saat ini {stockAvailable}</p></CardHeader><CardContent className="space-y-3">
            <label className="grid gap-1 text-xs font-semibold">Jumlah stok baru<Input type="number" min={0} step={1} value={stockQuantity} onChange={e=>setStockQuantity(e.target.value)} className="h-10 rounded-xl"/></label>
            <label className="grid gap-1 text-xs font-semibold">Alasan penyesuaian<Input value={stockReason} onChange={e=>setStockReason(e.target.value)} className="h-10 rounded-xl" placeholder="Contoh: stok awal hasil stock opname"/></label>
            <Alert><AlertDescription>Setiap perubahan saldo masuk ke jurnal pergerakan stok dan audit. Nilai tidak dapat dibuat negatif.</AlertDescription></Alert>
            <div className="flex justify-end gap-2"><Button variant="outline" className="rounded-xl" onClick={()=>setStockItem(null)}>Batal</Button><Button className="rounded-xl" disabled={adjustStock.isPending} onClick={()=>adjustStock.mutate()}>{adjustStock.isPending?"Menyimpan…":"Simpan Stok"}</Button></div>
          </CardContent></Card>
        </div>
      ):null}
    </div>
  );
}
