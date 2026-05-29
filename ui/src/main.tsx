import * as React from "react";
import { StrictMode } from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "@/lib/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { CompanyProvider } from "./context/CompanyContext";
import { LiveUpdatesProvider } from "./context/LiveUpdatesProvider";
import { BreadcrumbProvider } from "./context/BreadcrumbContext";
import { PanelProvider } from "./context/PanelContext";
import { SidebarProvider } from "./context/SidebarContext";
import { DialogProvider } from "./context/DialogContext";
import { EditorAutocompleteProvider } from "./context/EditorAutocompleteContext";
import { ToastProvider } from "./context/ToastContext";
import { ThemeProvider } from "./context/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initPluginBridge } from "./plugins/bridge-init";
import { PluginLauncherProvider } from "./plugins/launchers";
import { getPublicBasePath, withPublicBasePath } from "@/lib/public-base-path";
import "@mdxeditor/editor/style.css";
import "./index.css";

initPluginBridge(React, ReactDOM);

const publicBasePath = getPublicBasePath();

if (publicBasePath) {
  document.documentElement.dataset.paperclipHostedBasePath = publicBasePath;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const serviceWorkerPath = withPublicBasePath("/sw.js");
    const serviceWorkerScope = `${withPublicBasePath("/")}/`.replace(/\/{2,}/g, "/");
    const serviceWorkerPaths = new Set(["/sw.js", serviceWorkerPath]);

    const removePaperclipServiceWorkers = async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map((registration) => {
          const workerUrls = [registration.active, registration.waiting, registration.installing]
            .map((worker) => worker?.scriptURL)
            .filter((url): url is string => Boolean(url));
          const isPaperclipWorker = workerUrls.some((url) =>
            serviceWorkerPaths.has(new URL(url).pathname)
          );
          return isPaperclipWorker ? registration.unregister() : undefined;
        })
      );
    };

    if (publicBasePath) {
      void removePaperclipServiceWorkers().catch(() => undefined);
      return;
    }

    void removePaperclipServiceWorkers()
      .then(() => navigator.serviceWorker.register(serviceWorkerPath, { scope: serviceWorkerScope }))
      .catch(() => undefined);
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter basename={publicBasePath || undefined}>
          <CompanyProvider>
            <EditorAutocompleteProvider>
              <ToastProvider>
                <LiveUpdatesProvider>
                  <TooltipProvider>
                    <BreadcrumbProvider>
                      <SidebarProvider>
                        <PanelProvider>
                          <PluginLauncherProvider>
                            <DialogProvider>
                              <App />
                            </DialogProvider>
                          </PluginLauncherProvider>
                        </PanelProvider>
                      </SidebarProvider>
                    </BreadcrumbProvider>
                  </TooltipProvider>
                </LiveUpdatesProvider>
              </ToastProvider>
            </EditorAutocompleteProvider>
          </CompanyProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);
