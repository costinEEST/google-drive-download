export class CookieManager {
  constructor() {
    this.cookies = new Map();
  }

  parseCookies(setCookieHeaders) {
    if (!setCookieHeaders) return;
    const cookies = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : [setCookieHeaders];

    cookies.forEach((cookie) => {
      const [nameValue] = cookie.split(";");
      const [name, value] = nameValue.split("=");
      this.cookies.set(name.trim(), value.trim());
    });
  }

  getCookieString() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}
