import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LoyaltyProgressCard } from "@/components/penyewa/loyalty-progress-card";
import type { LoyaltyProgram } from "@/features/event-promotions/types";

const activeProgram: LoyaltyProgram = {
  program_loyalitas_id: "loyalty-1",
  usaha_id: "usaha-1",
  is_enabled: true,
  minimum_completed_rentals: 10,
  recommended_discount_percent: 6,
  valid_from: new Date(Date.now() - 60_000).toISOString(),
  valid_until: null,
  version: 2,
  updated_at: new Date().toISOString(),
};

function preview(completed: number, eligible: boolean) {
  return {
    program_loyalitas_id: "loyalty-1",
    is_enabled: true,
    is_in_period: true,
    eligible,
    completed_rental_count: completed,
    minimum_completed_rentals: 10,
    recommended_discount_percent: eligible ? 6 : 0,
    recommended_amount: 0,
    program_version: 2,
  };
}

describe("LoyaltyProgressCard", () => {
  test("shows animated progress toward the configured Model A threshold", async () => {
    render(
      <LoyaltyProgressCard
        program={activeProgram}
        preview={preview(8, false)}
        isLoading={false}
        isError={false}
        renterActive
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText("2 penyewaan lagi")).toBeInTheDocument();
    expect(screen.getByText("Manfaat setelah memenuhi syarat")).toBeInTheDocument();
    expect(screen.getByText("6%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "8");
    await waitFor(() => {
      expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ width: "80%" });
    });
  });

  test("keeps Model A eligibility after the threshold is exceeded", async () => {
    render(
      <LoyaltyProgressCard
        program={activeProgram}
        preview={preview(14, true)}
        isLoading={false}
        isError={false}
        renterActive
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText("Kelayakan tercapai")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "10");
    expect(screen.getByText("Tersedia di Walk-in")).toBeInTheDocument();
  });

  test("does not show qualification when server verification fails", () => {
    render(
      <LoyaltyProgressCard
        program={activeProgram}
        preview={null}
        isLoading={false}
        isError
        renterActive
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText("Kelayakan belum dapat diperiksa.")).toBeInTheDocument();
    expect(screen.queryByText("Kelayakan tercapai")).not.toBeInTheDocument();
  });
});
