/**
 * Attribution for the bundled SRD 5.1 content (monsters, spells, weapons, features).
 *
 * `SRD_ATTRIBUTION` is the statement the SRD 5.1 itself asks for, copied VERBATIM from the
 * "Legal Information" page of SRD_CC_v5.1.pdf (checked 2026-09-20). Do not reword it. That page also
 * says: "Please do not include any other attribution regarding Wizards other than that provided
 * above" — so nothing else in the app should credit or name Wizards, and the modification notice
 * below deliberately describes only our own changes.
 *
 * Used by the Docs "Credits & Licensing" section, the generated data files' headers, and the READMEs.
 * `tests/srd-attribution.test.ts` guards all of them against drifting from this text.
 */
export const SRD_ATTRIBUTION =
  "This work includes material taken from the System Reference Document 5.1 (\"SRD 5.1\") by Wizards of the Coast LLC and available at "
  + "https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 "
  + "International License available at https://creativecommons.org/licenses/by/4.0/legalcode.";

/**
 * CC-BY-4.0 §3(a)(1)(B) requires indicating that the material was modified. This states what we changed,
 * and — per the SRD's own request — says nothing further about Wizards.
 */
export const SRD_MODIFICATION_NOTICE =
  "The SRD material in this app has been modified: entries were converted into structured game data, "
  + "statblock and spell text was parsed into rules the simulator can run, and some entries were corrected or "
  + "simplified for simulation. They are not verbatim copies of the SRD text.";

/** In-app location of the credits, for links from other screens. */
export const SRD_CREDITS_PATH = "/docs#credits";
