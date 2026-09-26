import { Refine } from "@refinedev/core";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";
import routerProvider, {
  DocumentTitleHandler,
  UnsavedChangesNotifier,
} from "@refinedev/react-router";
import type { PropsWithChildren } from "react";
import { appConfig } from "@/app/config";
import { resources } from "@/app/router/resources";
import { useNotificationProvider } from "@/components/refine-ui/notification/use-notification-provider";
import { Toaster } from "@/components/refine-ui/notification/toaster";
import { ThemeProvider } from "@/components/refine-ui/theme/theme-provider";
import { dataProvider } from "./data";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <RefineKbarProvider>
      <ThemeProvider>
        <DevtoolsProvider>
          <Refine
            notificationProvider={useNotificationProvider()}
            routerProvider={routerProvider}
            dataProvider={dataProvider}
            resources={resources}
            options={{
              syncWithLocation: true,
              warnWhenUnsavedChanges: true,
              projectId: appConfig.refineProjectId,
            }}
          >
            {children}
            <Toaster />
            <RefineKbar />
            <UnsavedChangesNotifier />
            <DocumentTitleHandler />
          </Refine>
          <DevtoolsPanel />
        </DevtoolsProvider>
      </ThemeProvider>
    </RefineKbarProvider>
  );
}
