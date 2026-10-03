import { Fragment } from "react";
import { SRD_TOKEN_ICON_CREDITS } from "@/data/srd/tokens";

/** The CC BY 3.0 credit for the game-icons.net icons on the SRD monsters' placeholder tokens. */
export function TokenIconCredits() {
  const { source, license, authors } = SRD_TOKEN_ICON_CREDITS;
  return (
    <p id="token-icon-credits">
      The SRD monsters&apos; placeholder tokens use icons from{" "}
      <a href={source} target="_blank" rel="noopener noreferrer">game-icons.net</a>, licensed under{" "}
      <a href={license.url} target="_blank" rel="noopener noreferrer">{license.title}</a>. Icons made by{" "}
      {authors.map((author, index) => (
        <Fragment key={author.folder}>
          {index > 0 ? (index === authors.length - 1 ? " and " : ", ") : null}
          {author.url ? <a href={author.url} target="_blank" rel="noopener noreferrer">{author.name}</a> : author.name}
        </Fragment>
      ))}
      . Each icon was recoloured and placed on a coloured disc.
    </p>
  );
}
