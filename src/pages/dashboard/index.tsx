import { useGetIdentity } from "@refinedev/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type AdminIdentity = {
  id: string;
  name: string;
  email?: string;
  role?: string | null;
  status?: string | null;
};

const setupItems = [
  {
    title: "Autentikasi",
    description: "Supabase Auth menjadi sumber sesi admin.",
  },
  {
    title: "Profil admin",
    description: "Akun admin perlu terhubung ke akun_auth dan tenant.",
  },
  {
    title: "Usaha",
    description: "Belum ada data usaha pada workspace ini.",
  },
  {
    title: "Data operasional",
    description: "Dashboard tidak membuat data contoh secara otomatis.",
  },
];

export const Dashboard = () => {
  const { data: identity, isLoading } = useGetIdentity<AdminIdentity>();

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Control Center</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Dashboard Operasional
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Workspace kosong tetap menampilkan konteks dan langkah berikutnya,
          bukan angka bisnis fiktif.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg">Sesi Admin</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Status sesi berasal dari Supabase Auth.
            </p>
          </div>
          <Badge variant={identity?.status === "active" ? "default" : "secondary"}>
            {isLoading ? "Memuat" : identity?.status ?? "Profil belum tersedia"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="font-medium">Nama:</span>{" "}
            {isLoading ? "Memuat..." : identity?.name ?? "Belum teridentifikasi"}
          </p>
          <p>
            <span className="font-medium">Email:</span>{" "}
            {isLoading ? "Memuat..." : identity?.email ?? "—"}
          </p>
          <p>
            <span className="font-medium">Role:</span>{" "}
            {identity?.role ?? "Belum terhubung ke akun_admin"}
          </p>
        </CardContent>
      </Card>

      <section aria-labelledby="setup-title" className="space-y-3">
        <div>
          <h2 id="setup-title" className="text-lg font-semibold">
            Setup workspace
          </h2>
          <p className="text-sm text-muted-foreground">
            Tidak ada seed data bisnis pada first run.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {setupItems.map((item) => (
            <Card key={item.title}>
              <CardHeader>
                <CardTitle className="text-base">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {item.description}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
};
