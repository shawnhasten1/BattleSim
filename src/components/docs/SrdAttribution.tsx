import { Fragment } from "react";
import { SRD_52_ATTRIBUTION, SRD_ATTRIBUTION, SRD_MODIFICATION_NOTICE } from "@/data/srd/attribution";

/**
 * An SRD attribution statement with its two URLs made clickable. The visible text is exactly the statement — links
 * wrap the URLs, they never change a character.
 */
function Statement({ id, text }: { id: string; text: string }) {
  // A URL ends at the sentence's full stop ("…document." / "…legalcode.").
  const parts = text.split(/(https?:\/\/[^\s]+?)(?=\.(?:\s|$))/);
  return (
    <blockquote id={id}>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part)
          ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
          : <Fragment key={index}>{part}</Fragment>
      )}
    </blockquote>
  );
}

/** The SRD 5.1 and SRD 5.2 statements, then what we changed. */
export function SrdAttribution() {
  return (
    <>
      <Statement id="srd-attribution" text={SRD_ATTRIBUTION} />
      <Statement id="srd-52-attribution" text={SRD_52_ATTRIBUTION} />
      <p>{SRD_MODIFICATION_NOTICE}</p>
    </>
  );
}
