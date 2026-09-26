import { render, screen, within } from "@testing-library/react";
import App from "@/App";
import { stubFetch } from "./helpers";
import { mockViewport } from "./viewport";
import { describe, expect, test } from "vitest";

describe("scenario B — responsive admin shell", () => {
  test("mobile viewport renders the mobile header with a sidebar trigger", async () => {
    mockViewport(375, 812);
    stubFetch({ rows: [{ id: "1", title: "Post pertama" }] });

    window.history.pushState({}, "", "/blog-posts");
    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Toggle Sidebar" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  test("desktop viewport renders the desktop header without the mobile trigger", async () => {
    mockViewport(1280, 800);
    stubFetch({ rows: [{ id: "1", title: "Post pertama" }] });

    window.history.pushState({}, "", "/blog-posts");
    render(<App />);

    const banner = await screen.findByRole("banner");
    expect(
      within(banner).queryByRole("button", { name: "Toggle Sidebar" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeInTheDocument();
  });

  test("tablet viewport keeps navigation reachable", async () => {
    mockViewport(768, 1024);
    stubFetch({ rows: [{ id: "1", title: "Post pertama" }] });

    window.history.pushState({}, "", "/blog-posts");
    render(<App />);

    expect(await screen.findByRole("banner")).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: /blog posts/i }),
    ).toBeInTheDocument();
  });
});
