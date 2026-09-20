import { Fragment } from "react";
import { SRD_ATTRIBUTION, SRD_MODIFICATION_NOTICE } from "@/data/srd/attribution";

/**
 * The SRD attribution statement with its two URLs made clickable. The visible text is exactly
 * `SRD_ATTRIBUTION` — links wrap the URLs, they never change a character.
 */
export function SrdAttribution() {
  // A URL ends at the sentence's full stop ("…document." / "…legalcode.").
  const parts = SRD_ATTRIBUTION.split(/(https?:\/\/[^\s]+?)(?=\.(?:\s|$))/);
  return (
    <>
      <blockquote id="srd-attribution">
        {parts.map((part, index) =>
          /^https?:\/\//.test(part)
            ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
            : <Fragment key={index}>{part}</Fragment>
        )}
      </blockquote>
      <p>{SRD_MODIFICATION_NOTICE}</p>
    </>
  );
}
