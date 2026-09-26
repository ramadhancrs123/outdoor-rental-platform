import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "@/components/refine-ui/theme/theme-provider";
import { ThemeToggle } from "@/components/refine-ui/theme/theme-toggle";
import { describe, expect, test } from "vitest";

function Probe() {
  const { theme } = useTheme();
  return <span data-testid="current-theme">{theme}</span>;
}

describe("scenario C — theme foundation", () => {
  test("theme boots with system preference and applies a document class", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("current-theme")).toHaveTextContent("system");
    const root = document.documentElement;
    expect(
      root.classList.contains("light") || root.classList.contains("dark"),
    ).toBe(true);
  });

  test("toggle cycles system → light → dark → system and persists to storage", async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
        <Probe />
      </ThemeProvider>,
    );

    const toggle = screen.getByRole("button", {
      name: /toggle theme/i,
    });

    expect(screen.getByTestId("current-theme")).toHaveTextContent("system");

    await userEvent.click(toggle);
    expect(screen.getByTestId("current-theme")).toHaveTextContent("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(window.localStorage.getItem("refine-ui-theme")).toBe("light");

    await userEvent.click(toggle);
    expect(screen.getByTestId("current-theme")).toHaveTextContent("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("refine-ui-theme")).toBe("dark");

    await userEvent.click(toggle);
    expect(screen.getByTestId("current-theme")).toHaveTextContent("system");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(window.localStorage.getItem("refine-ui-theme")).toBe("system");
  });
});
