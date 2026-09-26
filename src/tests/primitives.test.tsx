import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { describe, expect, test, vi } from "vitest";

describe("shadcn primitive rendering", () => {
  test("button supports variants, disabled state and click", async () => {
    const onClick = vi.fn();
    render(
      <Button variant="destructive" onClick={onClick}>
        Hapus
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Hapus" });
    expect(button).toBeInTheDocument();

    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("disabled button is not clickable", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Simpan
      </Button>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Simpan" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  test("input renders with accessible name and accepts typing", async () => {
    render(
      <div>
        <Label htmlFor="penyewa">Nama penyewa</Label>
        <Input id="penyewa" />
      </div>,
    );

    const input = screen.getByLabelText("Nama penyewa");
    await userEvent.type(input, "Budi");
    expect(input).toHaveValue("Budi");
  });

  test("badge, card, separator and skeleton render their content", () => {
    render(
      <div>
        <Badge>Tersedia</Badge>
        <Card>
          <CardHeader>
            <CardTitle>Ringkasan</CardTitle>
          </CardHeader>
          <CardContent>Isi kartu</CardContent>
        </Card>
        <Separator />
        <Skeleton className="h-4 w-24" data-testid="skeleton" />
      </div>,
    );

    expect(screen.getByText("Tersedia")).toBeInTheDocument();
    expect(screen.getByText("Ringkasan")).toBeInTheDocument();
    expect(screen.getByText("Isi kartu")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });

  test("checkbox is keyboard operable and exposes checked state", async () => {
    render(
      <div>
        <Checkbox id="setuju" aria-label="Setuju" />
        <Label htmlFor="setuju">Setuju</Label>
      </div>,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Setuju" });
    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  test("textarea accepts multiline input", async () => {
    render(<Textarea aria-label="Catatan" />);
    const textarea = screen.getByLabelText("Catatan");

    await userEvent.type(textarea, "Baris satu{enter}Baris dua");
    expect(textarea).toHaveValue("Baris satu\nBaris dua");
  });
});
