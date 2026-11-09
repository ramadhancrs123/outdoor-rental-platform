const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export function createAkashaPortalLink(publicSiteUrl: string, token: string): string | null {
  if (!TOKEN_PATTERN.test(token)) return null;

  try {
    const url = new URL(publicSiteUrl);
    const isLocalhost = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) return null;

    url.pathname = "/booking/portal";
    url.search = "";
    url.hash = "access=" + token.toLowerCase();
    return url.toString();
  } catch {
    return null;
  }
}
