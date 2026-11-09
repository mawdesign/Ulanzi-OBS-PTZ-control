/** Poll until `cond()` is truthy, or fail with a readable message. */
export async function waitFor(cond, what = 'condition', timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Give the system a moment, for asserting that something does NOT happen. */
export const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
