import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const serviceMock = vi.hoisted(() => ({
  uploadCatalogVariantMediaFile: vi.fn(),
  setCatalogVariantMediaCover: vi.fn(),
  removeCatalogVariantMedia: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/features/katalog", () => ({
  uploadCatalogVariantMediaFile: serviceMock.uploadCatalogVariantMediaFile,
  setCatalogVariantMediaCover: serviceMock.setCatalogVariantMediaCover,
  removeCatalogVariantMedia: serviceMock.removeCatalogVariantMedia,
}));

vi.mock("sonner", () => ({
  toast: {
    success: serviceMock.toastSuccess,
    error: serviceMock.toastError,
  },
}));

import { VariantMediaManager } from "@/components/katalog/variant-media-manager";

describe("Catalog variant media manager", () => {
  test("uploads a shared first image as the variant cover", async () => {
    serviceMock.uploadCatalogVariantMediaFile.mockReset();
    serviceMock.uploadCatalogVariantMediaFile.mockResolvedValue({
      varian_barang_media_id: "media-1",
      usaha_id: "usaha-1",
      varian_barang_id: "variant-1",
      storage_bucket: "rental-public-media",
      storage_path: "usaha-1/varian/variant-1/media-1/cover.webp",
      media_type: "image/webp",
      urutan: 1,
      is_cover: true,
      status: "valid",
      url: "https://cdn.example.test/cover.webp",
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <VariantMediaManager usahaId="usaha-1" variantId="variant-1" media={[]} />
      </QueryClientProvider>,
    );

    const file = new File(["image-data"], "cover.webp", { type: "image/webp" });
    fireEvent.change(screen.getByRole("button", { name: "Pilih Foto" }).closest("section")!.querySelector("input[type=file]")!, {
      target: { files: [file] },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Simpan/ }));

    await waitFor(() => expect(serviceMock.uploadCatalogVariantMediaFile).toHaveBeenCalledWith(
      "usaha-1",
      "variant-1",
      file,
      { isCover: true, urutan: 1 },
    ));
  });

  test("shows a shared gallery and allows changing the variant cover", async () => {
    serviceMock.setCatalogVariantMediaCover.mockReset().mockResolvedValue({ is_cover: true });
    const media = [{
      varian_barang_media_id: "media-2",
      usaha_id: "usaha-1",
      varian_barang_id: "variant-1",
      storage_bucket: "rental-public-media",
      storage_path: "usaha-1/varian/variant-1/media-2/detail.webp",
      media_type: "image/webp",
      urutan: 2,
      is_cover: false,
      status: "valid",
      url: "https://cdn.example.test/detail.webp",
    }];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <VariantMediaManager usahaId="usaha-1" variantId="variant-1" media={media} />
      </QueryClientProvider>,
    );

    expect(screen.getByAltText("Foto varian 1")).toHaveAttribute("src", "https://cdn.example.test/detail.webp");
    fireEvent.click(screen.getByRole("button", { name: "Jadikan utama" }));

    await waitFor(() => expect(serviceMock.setCatalogVariantMediaCover).toHaveBeenCalledWith("usaha-1", "media-2", true));
  });
});
