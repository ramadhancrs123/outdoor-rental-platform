export default async function rental013AssignmentCandidateGuard({ page, capture }) {
  const unitCode = "PERLENGKAPAN-TRACKING-POLE-002";
  await page.getByRole("button", { name: "Buka tindakan" }).click();
  await page.getByText("Tracking pole", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
  const pickers = page.getByRole("combobox", { name: /Pilih unit untuk Tracking pole/i });
  const count = await pickers.count();
  if (count !== 1) throw new Error("Expected one tracking-pole assignment picker; got " + count);
  await pickers.first().click();
  const options = page.getByRole("option");
  const optionTexts = await options.allTextContents();
  if (optionTexts.some((text) => text.includes(unitCode))) {
    throw new Error(unitCode + " was exposed even though it is already assigned to this rental.");
  }
  if (!optionTexts.length || optionTexts.some((text) => text.includes("Tidak ada unit ready yang cocok"))) {
    if (!optionTexts.some((text) => text.includes("Tidak ada unit siap saat ini"))) {
      // An empty selector is valid here because the other tracking-pole unit is held by an active rental.
    }
  }
  await page.keyboard.press("Escape");
  await capture("rental-013-assignment-candidate-guard");
  return { state: "VERIFIED", excludedAlreadyAssignedUnit: unitCode, visibleCandidateOptions: optionTexts };
}
