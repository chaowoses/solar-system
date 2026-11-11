import { PIN_CHECK } from "./config.js";

const fromHex = (h) => Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));
const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** True if `pin` matches the PIN the site was built with. Only a hash is shipped. */
export async function verifyPin(pin) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(PIN_CHECK.salt), iterations: PIN_CHECK.iterations },
    key,
    256
  );
  return toHex(bits) === PIN_CHECK.hash;
}
