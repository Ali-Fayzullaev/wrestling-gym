import { PHONE_PATTERN } from "./phone";

/**
 * The only way the app talks to WhatsApp: a wa.me link that opens a chat with the text typed in.
 * Nothing is sent until a person presses "send" in WhatsApp itself.
 * `buildWaLink("+77011234567", "Здравствуйте")` → `https://wa.me/77011234567?text=...`.
 */
export function buildWaLink(phone: string, text: string): string {
  if (!PHONE_PATTERN.test(phone)) {
    // The database only stores +77XXXXXXXXX; anything else is a bug upstream, and the message is
    // generic so the number never lands in a log.
    throw new RangeError("buildWaLink expects a +77XXXXXXXXX phone");
  }
  // wa.me wants the number without "+"; encodeURIComponent also covers &, #, + and line breaks.
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(text)}`;
}
