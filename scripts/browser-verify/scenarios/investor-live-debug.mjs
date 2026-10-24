export default async function scenario({ page, capture }) {
  const data = await page.locator('span,div').evaluateAll((els) =>
    els.filter((el) => el.textContent?.trim() === 'Live').map((el) => ({
      tag: el.tagName,
      cls: el.getAttribute('class'),
      display: getComputedStyle(el).display,
      rect: (() => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })(),
      parent: el.parentElement?.outerHTML.slice(0, 500),
    }))
  );
  console.log(JSON.stringify(data, null, 2));
  await capture('live-debug');
  return { state: 'VERIFIED' };
}
