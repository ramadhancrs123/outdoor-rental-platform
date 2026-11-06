"use client";

import { useLogout } from "@refinedev/core";
import { Loader2, LogOut } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FOOTER_SELECTOR = '[data-sidebar="footer"]';

function useSidebarFooters() {
  const [footers, setFooters] = React.useState<Element[]>([]);

  React.useEffect(() => {
    const sync = () =>
      setFooters((previous) => {
        const next = Array.from(document.querySelectorAll<Element>(FOOTER_SELECTOR));
        const unchanged =
          previous.length === next.length &&
          previous.every((node, index) => node === next[index]);
        return unchanged ? previous : next;
      });

    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-sidebar", "data-collapsible"],
    });

    return () => observer.disconnect();
  }, []);

  return footers;
}

export function SidebarLogout() {
  const { mutate: logout, isPending } = useLogout();
  const footers = useSidebarFooters();

  if (footers.length === 0) return null;

  return (
    <>
      {footers.map((footer, index) =>
        createPortal(
          <Button
            key={index}
            type="button"
            variant="ghost"
            disabled={isPending}
            aria-label="Keluar"
            onClick={() => logout()}
            className={cn(
              "mt-1 h-9 w-full justify-start gap-3 rounded-lg px-3 text-[13px] font-medium",
              "text-sidebar-foreground/65 hover:bg-destructive/10 hover:text-destructive",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              "disabled:opacity-60",
              "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2",
            )}
          >
            {isPending ? (
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <LogOut className="size-4 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate group-data-[collapsible=icon]:hidden">Keluar</span>
          </Button>,
          footer,
        ),
      )}
    </>
  );
}

SidebarLogout.displayName = "SidebarLogout";
