export default async function debug({ page, baseURL, capture }) {
  await page.goto(baseURL + "/keuangan/pengeluaran", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const data = await page.evaluate(() => {
    const vw = window.innerWidth;
    const bad = Array.from(document.querySelectorAll("body *")).map((el) => {
      const r = el.getBoundingClientRect();
      return {tag:el.tagName, cls:el.className?.toString?.().slice(0,180), left:r.left,right:r.right,width:r.width,text:(el.textContent||"").trim().slice(0,100)};
    }).filter(x => x.right > vw + 1 || x.left < -1).sort((a,b)=>(b.right-vw)-(a.right-vw)).slice(0,20);
    return {vw, scrollWidth:document.documentElement.scrollWidth,bad};
  });
  console.log(JSON.stringify(data,null,2));
  await capture("debug");
  return {state:"DEBUG", data};
}
