import { BrowserRouter } from "react-router";
import { AppProviders } from "@/app/providers";
import { AppRoutes } from "@/routes";

export function AppRouter() {
  return (
    <BrowserRouter>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </BrowserRouter>
  );
}
