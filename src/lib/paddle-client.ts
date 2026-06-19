import { initializePaddle, type Paddle } from "@paddle/paddle-js";

let paddlePromise: Promise<Paddle | undefined> | null = null;

export function loadPaddle(opts: {
  clientToken: string;
  environment: "sandbox" | "production";
  onComplete?: () => void;
  onClose?: () => void;
}): Promise<Paddle | undefined> {
  if (paddlePromise) return paddlePromise;
  paddlePromise = initializePaddle({
    token: opts.clientToken,
    environment: opts.environment,
    eventCallback: (event) => {
      if (event.name === "checkout.completed") opts.onComplete?.();
      if (event.name === "checkout.closed") opts.onClose?.();
    },
  });
  return paddlePromise;
}
