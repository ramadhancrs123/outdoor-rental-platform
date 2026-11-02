export default async function rentalDummyReturnStateGuard({ page, capture }) {
  await page.getByTestId("rental-operational-workspace").waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("rental-operational-workspace").getByText("PERLENGKAPAN-TRACKING-POLE-001", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Penerimaan unit diblokir", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  const workspace = page.getByTestId("rental-operational-workspace");
  const text = (await workspace.innerText()).toLowerCase();
  if (!text.includes("status inventaris ready")) throw new Error("Expected the fixture unit to show inventory status ready.");
  if (await workspace.getByRole("button", { name: /Pilih kondisi/ }).count()) throw new Error("Invalid condition picker is still exposed.");
  if (await workspace.getByRole("button", { name: /Terima Unit \+ Proses Kondisi/ }).count()) throw new Error("Invalid return action is still exposed.");
  await capture("rental-dummy-return-state-guard");
  return { state: "VERIFIED", invalidReturnBlocked: true, reason: "Inventory unit is ready, without canonical handover/return state." };
}
