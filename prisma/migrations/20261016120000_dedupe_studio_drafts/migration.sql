-- One-off clean-up (docs/CONTENT.md): two page loads at once could draft the same content twice before drafting took a
-- per-content lock. Removes exact duplicate drafts BuPulse made that the owner never touched (same content, app and
-- account, still a draft or waiting for review), keeping the oldest of each. Nothing the owner edited, approved,
-- scheduled or posted is touched.
DELETE FROM "Post" p
USING (
  SELECT "id", row_number() OVER (
    PARTITION BY "contentId", "network", COALESCE("connectionId", '')
    ORDER BY "createdAt", "id"
  ) AS n
  FROM "Post"
  WHERE "source" = 'STUDIO'
    AND "contentId" IS NOT NULL
    AND "ownerEditedAt" IS NULL
    AND "status" IN ('PENDING_APPROVAL', 'DRAFT')
) d
WHERE p."id" = d."id" AND d.n > 1;
