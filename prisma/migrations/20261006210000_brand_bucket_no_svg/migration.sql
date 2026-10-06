-- SVG files can carry scripts; logos may later be shown inline (chat widget, designs, emails).
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
WHERE id = 'brand';
