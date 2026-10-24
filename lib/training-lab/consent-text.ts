// What the owner is told before and after withdrawing an actor's consent (consent.ts). Pure: the edit form shows the
// confirm, the server's actions say what was really removed.

export function withdrawText(uses: number): { confirm: string; done: string } {
  const businesses = `${uses} business${uses === 1 ? "" : "es"}`;
  const theirs = uses === 1 ? "1 business's presenter" : `${uses} businesses' presenters`;
  return uses > 0
    ? { confirm: `This also removes them as the presenter of ${businesses}. Reels already made are not changed.`, done: `Consent withdrawn: removed from ${theirs}. Reels already made are not changed.` }
    : { confirm: "They stay in the Lab but are never used again. Reels already made are not changed.", done: "Consent withdrawn: this actor stays in the Lab but is never used." };
}
