export class PromiseTimeoutError extends Error {
  constructor(label = "Операція") {
    super(`${label} триває занадто довго — спробуйте ще раз`);
    this.name = "PromiseTimeoutError";
  }
}

/** Обмежує очікування — щоб UI не «висів» безкінечно. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label?: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new PromiseTimeoutError(label));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}
