import type { UseTableReturnType } from "@refinedev/react-table";
import { useTable } from "@refinedev/react-table";
import type { ColumnDef } from "@tanstack/react-table";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AppProviders } from "@/app/providers";
import { DataTable } from "@/components/refine-ui/data-table/data-table";
import { DataTableSorter } from "@/components/refine-ui/data-table/data-table-sorter";
import { stubFetch } from "./helpers";
import { describe, expect, test } from "vitest";

type Row = { id: string; title: string; status: string };

const rows: Row[] = [
  { id: "1", title: "Post Alpha", status: "publish" },
  { id: "2", title: "Post Beta", status: "draft" },
];

const columns: ColumnDef<Row>[] = [
  { accessorKey: "id", header: "ID" },
  {
    id: "title",
    accessorKey: "title",
    header: ({ column }) => <DataTableSorter column={column} />,
  },
  { accessorKey: "status", header: "Status" },
];

let tableRef: UseTableReturnType<Row> | undefined;

function Harness() {
  const table = useTable<Row>({
    refineCoreProps: {
      resource: "blog_posts",
      syncWithLocation: false,
      pagination: { pageSize: 1 },
    },
    columns,
  });
  tableRef = table;
  return <DataTable table={table} />;
}

function renderTable() {
  tableRef = undefined;
  const fetchMock = stubFetch<Row>({ rows });
  const { container } = render(
    <MemoryRouter initialEntries={["/blog-posts"]}>
      <AppProviders>
        <Harness />
      </AppProviders>
    </MemoryRouter>,
  );
  return { fetchMock, container };
}

function fetchUrls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.map(([input]) =>
    input instanceof Request ? input.url : String(input),
  );
}

describe("scenario E — data table foundation (TanStack + Refine + shadcn)", () => {
  test("renders rows from the server response", async () => {
    renderTable();

    expect(await screen.findByText("Post Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Post Beta")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("2 row(s)")).toBeInTheDocument();
  });

  test("sorting updates table state and requests server-side sort", async () => {
    const { fetchMock } = renderTable();
    const user = userEvent.setup();

    await screen.findByText("Post Alpha");
    await user.click(screen.getByRole("button", { name: "Sort by title" }));

    expect(
      await screen.findByRole("button", { name: /Sort by title as/ }),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(fetchUrls(fetchMock).some((url) => /order=/i.test(url))).toBe(
        true,
      ),
    );
  });

  test("pagination moves to the next page with server-side state", async () => {
    const { fetchMock } = renderTable();
    const user = userEvent.setup();

    await screen.findByText("Post Alpha");
    await user.click(screen.getByRole("button", { name: "Go to next page" }));

    expect(await screen.findByText("Post Beta")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();

    await waitFor(() =>
      expect(fetchUrls(fetchMock).some((url) => /offset=1(&|$)/.test(url))).toBe(
        true,
      ),
    );
  });

  test("column visibility can hide a column", async () => {
    renderTable();
    await screen.findByText("Post Alpha");

    expect(screen.getByText("Status")).toBeInTheDocument();

    act(() => {
      tableRef?.reactTable.getColumn("status")?.toggleVisibility(false);
    });

    expect(screen.queryByText("Status")).not.toBeInTheDocument();
  });

  test("row selection marks the selected row", async () => {
    const { container } = renderTable();
    await screen.findByText("Post Alpha");

    act(() => {
      tableRef?.reactTable.getRow("0")?.toggleSelected(true);
    });

    expect(container.querySelector('tr[data-state="selected"]')).toBeTruthy();
  });
});
