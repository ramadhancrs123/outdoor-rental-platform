export default async function overflowDebug({ page }) {
  const data = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const hits = [...document.querySelectorAll("body *")].map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, cls: el.className, left: r.left, right: r.right, width: r.width, text: (el.textContent || "").trim().slice(0,120) };
    }).filter(x => x.right > vw + 0.5 || x.left < -0.5).sort((a,b)=>b.right-a.right).slice(0,20);
    return {vw, scrollWidth:document.documentElement.scrollWidth, hits};
  });
  throw new Error(JSON.stringify(data));
}
