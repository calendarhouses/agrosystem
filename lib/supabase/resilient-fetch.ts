/** Нові ключі sb_* — не JWT; Bearer з ними інколи дає «JWT issued at future». */

export function isJwtIssuedAtFuture(body: string): boolean {
  return /JWT issued at future/i.test(body);
}

export function createSupabaseResilientFetch(apiKey: string): typeof fetch {
  return async (input, init = {}) => {
    const headers = new Headers(init.headers ?? {});

    if (apiKey.startsWith("sb_")) {
      const auth = headers.get("Authorization");
      if (
        auth &&
        (auth === `Bearer ${apiKey}` || /\bsb_(publishable|secret)_/.test(auth))
      ) {
        headers.delete("Authorization");
      }
    }

    const requestInit = { ...init, headers };
    const first = await fetch(input, requestInit);
    if (first.status !== 401) return first;

    const body = await first.clone().text();
    if (!isJwtIssuedAtFuture(body)) return first;

    await new Promise((resolve) => setTimeout(resolve, 900));
    return fetch(input, requestInit);
  };
}
