import { render, screen, waitFor } from "@testing-library/react";
import App from "@/App";
import { stubFetch } from "./helpers";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "test-auth-user" } } }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-auth-user", email: "admin@akasha.com" } }, error: null }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: { akun_admin_id: "test-admin", nama_tampilan: "Admin Akasha", role: "super_admin", status: "active" }, error: null }),
        })),
      })),
    })),
  },
}));

describe("scenario A — app boot", () => {
  test("boots without runtime error and lands on the first resource", async () => {
    stubFetch({ rows: [{ id: "1", title: "Post pertama" }] });

    window.history.pushState({}, "", "/");
    const { container } = render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));

    expect(container.querySelector("main")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  test("router boot — unknown route renders the error component", async () => {
    stubFetch({ rows: [] });

    window.history.pushState({}, "", "/tidak-ada");
    render(<App />);

    expect(await screen.findByText("Page not found.")).toBeInTheDocument();
  });

  test("Refine provider boot — resources are registered in the sidebar menu", async () => {
    stubFetch({ rows: [{ id: "1", title: "Post pertama" }] });

    window.history.pushState({}, "", "/blog-posts");
    render(<App />);

    expect(
      await screen.findByRole("link", { name: /blog posts/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: /categories/i }),
    ).toBeInTheDocument();
  });
});
