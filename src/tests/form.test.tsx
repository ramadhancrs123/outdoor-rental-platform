import { zodResolver } from "@hookform/resolvers/zod";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { describe, expect, test, vi } from "vitest";

const schema = z.object({
  nama: z.string().min(3, "Nama minimal 3 karakter"),
});

type FormValues = z.infer<typeof schema>;

function TestForm({ onSubmit }: { onSubmit: (values: FormValues) => void }) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { nama: "" },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FormField
          control={form.control}
          name="nama"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nama penyewa</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Simpan</Button>
      </form>
    </Form>
  );
}

describe("scenario D — form foundation (RHF + Zod + shadcn Form)", () => {
  test("invalid input shows a field error and blocks submission", async () => {
    const onSubmit = vi.fn();
    render(<TestForm onSubmit={onSubmit} />);

    const input = screen.getByLabelText("Nama penyewa");
    await userEvent.type(input, "Ab");
    await userEvent.click(screen.getByRole("button", { name: "Simpan" }));

    expect(
      await screen.findByText("Nama minimal 3 karakter"),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("empty input shows a validation error", async () => {
    const onSubmit = vi.fn();
    render(<TestForm onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole("button", { name: "Simpan" }));

    expect(
      await screen.findByText("Nama minimal 3 karakter"),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("valid input submits the form values", async () => {
    const onSubmit = vi.fn();
    render(<TestForm onSubmit={onSubmit} />);

    const input = screen.getByLabelText("Nama penyewa");
    await userEvent.type(input, "Budi Santoso");
    await userEvent.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        { nama: "Budi Santoso" },
        expect.anything(),
      ),
    );
    expect(screen.queryByText("Nama minimal 3 karakter")).not.toBeInTheDocument();
  });
});
