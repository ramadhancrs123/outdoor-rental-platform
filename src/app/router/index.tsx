import { BrowserRouter } from "react-router";
import { AppProviders } from "@/app/providers";
import { AppRoutes } from "@/routes";
import { SidebarLogout } from "@/components/refine-ui/layout/sidebar-logout";

export function AppRouter() {
  return (
    <BrowserRouter>
      <AppProviders>
        <SidebarLogout />
        <AppRoutes />
      </AppProviders>
    </BrowserRouter>
  );
}
