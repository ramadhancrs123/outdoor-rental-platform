"use client";

import { useLogin } from "@refinedev/core";
import { AlertCircle, ArrowRight, BarChart3, CalendarDays, CheckCircle2, Eye, EyeOff, FileText, LockKeyhole, Mail, MonitorSmartphone, PackageOpen, UsersRound, Zap } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const benefits = [
  { icon: CheckCircle2, title: "Lebih Rapi", detail: "Operasional terorganisir" },
  { icon: Zap, title: "Lebih Efisien", detail: "Hemat waktu & tenaga" },
  { icon: BarChart3, title: "Lebih Berkembang", detail: "Keputusan berbasis data" },
] as const;

const modules = [
  { icon: CalendarDays, label: "Penyewaan & Reservasi" },
  { icon: PackageOpen, label: "Inventaris Alat" },
  { icon: UsersRound, label: "Pelanggan & Penyewa" },
  { icon: BarChart3, label: "Keuangan Usaha" },
  { icon: FileText, label: "Laporan Lengkap" },
  { icon: MonitorSmartphone, label: "Multi Perangkat" },
] as const;

function authMessage(error: unknown) {
  if (!error) return "";
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login") || normalized.includes("invalid credentials")) {
    return "Email atau kata sandi belum benar. Periksa kembali lalu coba lagi.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Email akun belum dikonfirmasi. Periksa inbox untuk menyelesaikan verifikasi.";
  }
  return "Login belum berhasil. Periksa koneksi dan data akun Anda, lalu coba lagi.";
}

export const SignInForm = () => {
  const [rememberMe, setRememberMe] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const { mutate: login, isPending, error } = useLogin();

  const handleSignIn = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;
    login({ email: email.trim(), password });
  };

  const handleSignInWithGoogle = () => {
    if (!isPending) login({ providerName: "google" });
  };

  const handleSignInWithGitHub = () => {
    if (!isPending) login({ providerName: "github" });
  };

  return (
    <main className="min-h-svh overflow-x-hidden bg-[#eef2f0] text-[#102b29]">
      <div className="relative min-h-svh bg-[#eef2f0] md:bg-transparent">
        <div
          className="absolute inset-0 hidden bg-center bg-no-repeat md:block"
          style={{
            backgroundImage: "url('/login-bg.png')",
            backgroundPosition: "center center",
            backgroundSize: "cover",
          }}
          aria-hidden="true"
        />

        <div className="relative mx-auto grid min-h-svh max-w-[1540px] gap-4 p-0 md:grid-cols-[minmax(0,1fr)_minmax(410px,458px)] md:items-center md:gap-8 md:px-8 md:py-8 xl:grid-cols-[minmax(0,1fr)_470px]">
          <section className="relative hidden min-h-[calc(100svh-64px)] overflow-hidden rounded-[32px] border border-white/65 bg-white/[0.23] p-10 shadow-[0_20px_80px_rgba(36,56,49,.12)] backdrop-blur-[2px] lg:flex lg:flex-col lg:justify-between xl:p-14">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-3">
                <div className="grid size-12 place-items-center overflow-hidden rounded-2xl bg-white/82 shadow-sm backdrop-blur">
                  <img src="/logo.png" alt="" className="h-full w-full object-contain p-1.5" />
                </div>
                <div className="leading-tight">
                  <p className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b211e]">AKASHA</p>
                  <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#37544d]">Outdoor Rent</p>
                </div>
              </div>

              <div className="max-w-xl pt-4">
                <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.32em] text-[#415c55]">Sistem Manajemen</p>
                <h1 className="font-serif text-5xl font-semibold leading-[0.98] tracking-[-0.04em] text-[#112825] xl:text-[62px]">
                  Jasa Sewa
                  <br />
                  Alat <em>Outdoor</em>
                </h1>
                <p className="mt-6 max-w-lg text-[17px] leading-7 text-[#3a534e]">
                  Kelola penyewaan, inventaris, pemesanan, pelanggan, keuangan, dan operasional usaha rental outdoor Anda dalam satu sistem yang modern dan profesional.
                </p>
              </div>

              <div className="grid max-w-2xl grid-cols-2 gap-3 xl:grid-cols-3">
                {modules.map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-3 rounded-2xl border border-white/70 bg-white/48 px-4 py-3 backdrop-blur-sm">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/80 text-[#1f554c] shadow-sm">
                      <Icon className="size-5" strokeWidth={1.8} />
                    </span>
                    <span className="text-sm font-medium leading-5 text-[#1c3733]">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 xl:gap-5">
              {benefits.map(({ icon: Icon, title, detail }) => (
                <div
                  key={title}
                  className="relative overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/78 via-white/52 to-white/32 px-3.5 py-3 shadow-[0_14px_34px_rgba(36,56,49,.12)] backdrop-blur-md"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-7 -top-9 size-24 rounded-full bg-[#1f554c]/15 blur-2xl"
                  />
                  <div className="relative flex items-start gap-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#1f554c] to-[#0b5544] text-white shadow-[0_8px_18px_rgba(15,94,75,.3)]">
                      <Icon className="size-[18px]" strokeWidth={2.1} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#1c3a34]">{title}</p>
                      <p className="mt-0.5 text-[11px] leading-4 text-[#4a605a]">{detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="relative z-10 flex min-h-svh flex-col overflow-hidden md:min-h-0">
            <div
              className="absolute inset-0 bg-center bg-cover bg-no-repeat md:hidden"
              style={{
                backgroundImage: "url('/login-bg.png')",
                backgroundPosition: "center center",
              }}
              aria-hidden="true"
            />
            <div className="absolute inset-0 bg-black/5 md:hidden" aria-hidden="true" />

            <div className="relative flex min-h-[56svh] flex-col items-center justify-between px-5 pb-20 pt-10 text-white md:hidden">
              <div className="flex flex-col items-center">
                <div className="grid size-20 place-items-center overflow-hidden rounded-[24px] bg-white/86 shadow-[0_10px_30px_rgba(0,0,0,.16)] backdrop-blur">
                  <img src="/logo.png" alt="Akasha Outdoor Rent" className="h-full w-full object-contain p-2" />
                </div>
                <p className="mt-2 text-[17px] font-semibold tracking-[-0.02em] drop-shadow-md">AKASHA</p>
                <p className="text-[9px] font-medium uppercase tracking-[0.28em] text-white/90 drop-shadow-md">Outdoor Rent</p>
              </div>

              <div className="w-full max-w-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/82">Sistem rental outdoor</p>
                <h1 className="mt-2 max-w-[310px] text-[31px] font-semibold leading-[1.02] tracking-[-0.035em] drop-shadow-[0_3px_18px_rgba(0,0,0,.28)]">
                  Kelola Usaha Rental Outdoor
                  <br />
                  <span className="font-normal">dalam Satu Sistem</span>
                </h1>
                <p className="mt-3 text-sm leading-6 text-white/88">Lebih rapi, lebih efisien, lebih berkembang.</p>
              </div>
            </div>

            <div className="relative z-10 -mt-10 flex flex-1 flex-col rounded-t-[30px] border border-white/75 bg-white px-5 pb-8 pt-5 shadow-[0_-16px_50px_rgba(40,58,52,.14)] md:mx-auto md:my-auto md:mt-0 md:w-full md:max-w-[458px] md:rounded-[30px] md:border-white/70 md:px-8 md:py-8 md:shadow-[0_24px_70px_rgba(31,51,45,.16)]">
              <div className="mb-6 text-center md:text-left">
                <div className="hidden items-center justify-center md:flex">
                  <div className="grid size-16 place-items-center overflow-hidden rounded-2xl bg-[#f1f5f3]">
                    <img src="/logo.png" alt="" className="h-full w-full object-contain p-1.5" />
                  </div>
                </div>
                <h2 className="mt-2 text-[23px] font-semibold tracking-[-0.025em] text-[#16322e] md:text-center">Masuk ke Akasha</h2>
                <p className="mt-1 text-sm leading-6 text-[#70817d] md:text-center">Kelola usaha rental outdoor Anda dengan aman</p>
              </div>

              <div className="mb-5 grid grid-cols-2 border-b border-[#dce5e1]" role="tablist" aria-label="Autentikasi">
                <button type="button" role="tab" aria-selected="true" className="relative h-11 text-sm font-semibold text-[#1a4c43]">
                  Login
                  <span className="absolute inset-x-6 -bottom-px h-0.5 rounded-full bg-[#0f5e4c]" />
                </button>
                <button type="button" role="tab" aria-selected="false" disabled className="h-11 text-sm font-medium text-[#8b9793] disabled:cursor-default">
                  Daftar Akun
                </button>
              </div>

              {error ? (
                <Alert variant="destructive" className="mb-4 rounded-2xl">
                  <AlertCircle />
                  <AlertTitle>Login belum berhasil</AlertTitle>
                  <AlertDescription>{authMessage(error)}</AlertDescription>
                </Alert>
              ) : null}

              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-semibold text-[#304641]">Email atau nomor telepon</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#8da09a]" aria-hidden="true" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="username"
                      placeholder="Masukkan email atau nomor telepon"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="h-12 rounded-xl border-[#d8e2de] bg-white pl-10 text-sm shadow-none placeholder:text-[#9aa7a3] focus:border-[#4b7c70] focus:ring-[#4b7c70]/20"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-semibold text-[#304641]">Kata sandi</Label>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#8da09a]" aria-hidden="true" />
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="Masukkan kata sandi"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-12 rounded-xl border-[#d8e2de] bg-white pl-10 pr-10 text-sm shadow-none placeholder:text-[#9aa7a3] focus:border-[#4b7c70] focus:ring-[#4b7c70]/20"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[#7f928b] hover:bg-[#eef4f1]"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="remember" className="flex min-w-0 items-center gap-2 text-sm text-[#52635e]">
                    <Checkbox
                      id="remember"
                      checked={rememberMe}
                      onCheckedChange={(checked) => setRememberMe(checked === true)}
                      className="size-4 rounded-[5px] data-[state=checked]:border-[#0e5d4b] data-[state=checked]:bg-[#0e5d4b]"
                    />
                    <span>Ingat saya</span>
                  </label>
                  <button type="button" className="shrink-0 text-xs font-semibold text-[#1d564c] hover:underline md:text-sm">
                    Lupa kata sandi?
                  </button>
                </div>

                <Button
                  type="submit"
                  disabled={isPending}
                  className="h-12 w-full rounded-xl bg-[#075d4b] text-sm font-semibold shadow-[0_10px_20px_rgba(7,93,75,.18)] hover:bg-[#064f40]"
                >
                  {isPending ? "Memproses..." : "Masuk"}
                  <ArrowRight className="size-4" />
                </Button>

                <div className="flex items-center gap-3">
                  <Separator className="bg-[#e1e8e5]" />
                  <span className="shrink-0 text-xs text-[#8a9893]">atau masuk dengan</span>
                  <Separator className="bg-[#e1e8e5]" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    type="button"
                    disabled={isPending}
                    onClick={handleSignInWithGoogle}
                    className="h-11 rounded-xl border-[#d8e2de] bg-white text-sm font-medium text-[#314641] hover:bg-[#f4f8f6]"
                  >
                    <span className="grid size-5 place-items-center text-[#4285F4] font-bold">G</span>
                    Google
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={isPending}
                    onClick={handleSignInWithGitHub}
                    className="h-11 rounded-xl border-[#d8e2de] bg-white text-sm font-medium text-[#314641] hover:bg-[#f4f8f6]"
                  >
                    <span className="grid size-5 place-items-center text-[#111827] dark:text-white">
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 2C6.477 2 2 6.586 2 12.28c0 4.535 2.865 8.379 6.839 9.737.5.094.682-.22.682-.49 0-.243-.009-.888-.014-1.744-2.782.621-3.369-1.38-3.369-1.38-.455-1.188-1.111-1.504-1.111-1.504-.908-.637.069-.624.069-.624 1.005.073 1.534 1.059 1.534 1.059.893 1.574 2.341 1.12 2.913.856.091-.665.35-1.12.636-1.378-2.22-.259-4.555-1.142-4.555-5.087 0-1.124.389-2.043 1.03-2.764-.104-.258-.446-1.305.097-2.722 0 0 .84-.276 2.755 1.055A9.18 9.18 0 0 1 12 7.405a9.2 9.2 0 0 1 2.507.356c1.913-1.331 2.751-1.055 2.751-1.055.545 1.417.202 2.464.099 2.722.642.721 1.028 1.64 1.028 2.764 0 3.956-2.339 4.825-4.566 5.079.359.322.678.955.678 1.927 0 1.391-.013 2.51-.013 2.852 0 .272.18.589.688.489C19.139 20.654 22 16.812 22 12.28 22 6.586 17.523 2 12 2Z" />
                      </svg>
                    </span>
                    GitHub
                  </Button>
                </div>

                <p className="pb-1 text-center text-[11px] leading-5 text-[#8b9894]">
                  Dengan masuk, Anda menyetujui <span className="font-medium text-[#46645c]">Syarat Layanan</span> dan <span className="font-medium text-[#46645c]">Kebijakan Privasi</span> kami.
                </p>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
};

SignInForm.displayName = "SignInForm";
