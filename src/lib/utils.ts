import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label = "Operation",
): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timeoutId) globalThis.clearTimeout(timeoutId);
  });
}
