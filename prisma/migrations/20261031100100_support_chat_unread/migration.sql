-- Support chat, second step: the buttons an AI answer carries ("Open Channels") get their own column, and the heartbeat
-- also says how many agent messages the visitor has not seen, so a chat an agent starts from the live-visitors list
-- (or a reply that came while the panel was closed) can open the widget without the visitor holding a socket.

-- AlterTable
ALTER TABLE "SupportMessage" ADD COLUMN     "aiActions" JSONB;

CREATE OR REPLACE FUNCTION public.support_heartbeat(p_token text, p_path text, p_title text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamp := (now() AT TIME ZONE 'utc');
  v_visit "SupportVisit"%ROWTYPE;
  v_path text := nullif(left(coalesce(p_path, ''), 500), '');
  v_title text := nullif(left(coalesce(p_title, ''), 300), '');
  v_changed boolean;
  v_unread integer;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 OR length(p_token) > 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  SELECT * INTO v_visit FROM "SupportVisit" WHERE "tokenHash" = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown');
  END IF;
  IF v_visit."endedAt" IS NOT NULL OR v_visit."lastSeenAt" < v_now - interval '20 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  v_changed := v_path IS NOT NULL AND v_path IS DISTINCT FROM v_visit."currentPath";
  IF (NOT v_changed AND v_visit."lastSeenAt" > v_now - interval '10 seconds') OR (v_changed AND v_visit."lastSeenAt" > v_now - interval '1 second') THEN
    RETURN jsonb_build_object('ok', true, 'throttled', true);
  END IF;
  UPDATE "SupportVisit" SET
    "lastSeenAt" = v_now,
    "currentPath" = coalesce(v_path, "currentPath"),
    "currentTitle" = CASE WHEN v_changed THEN v_title ELSE coalesce(v_title, "currentTitle") END,
    "pageCount" = "pageCount" + CASE WHEN v_changed THEN 1 ELSE 0 END
  WHERE "id" = v_visit."id";
  IF v_changed THEN
    IF v_visit."pageCount" < 50 THEN
      INSERT INTO "SupportPageHit" ("id", "visitId", "path", "title", "at") VALUES (gen_random_uuid()::text, v_visit."id", v_path, v_title, v_now);
    END IF;
    BEGIN
      PERFORM realtime.send(jsonb_build_object('type', 'visitor.changed', 'visitId', v_visit."id"), 'support', 'staff:visitors', true);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  SELECT count(*)::integer INTO v_unread
  FROM "SupportMessage" m JOIN "SupportConversation" c ON c."id" = m."conversationId"
  WHERE c."visitorId" = v_visit."visitorId" AND c."status" <> 'CLOSED'
    AND m."author" = 'AGENT' AND m."kind" <> 'NOTE' AND m."seenByVisitorAt" IS NULL;
  RETURN jsonb_build_object('ok', true, 'unread', v_unread);
END;
$$;
REVOKE ALL ON FUNCTION public.support_heartbeat(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_heartbeat(text, text, text) TO anon, authenticated;
