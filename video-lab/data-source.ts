// Video Lab (docs/VIDEO_ENGINE.md): reads the TEST database and storage, read-only. Businesses, products and their
// photos (resized and cached on disk), and the music library. Never writes to the database.
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";

const DATA = path.resolve("video-lab/data");
let pool: pg.Pool | null = null;

function db(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set in .env");
    pool = new pg.Pool({ connectionString: url, max: 3 });
  }
  return pool;
}

function storage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env");
  return createClient(url, key, { auth: { persistSession: false } }).storage;
}

export type LabBusiness = { id: string; name: string; products: number };
export type LabPhoto = { assetId: string; width: number | null; height: number | null; description: string | null };
export type LabProduct = {
  id: string;
  name: string;
  summary: string;
  description: string | null;
  price: string | null;
  usps: string[];
  features: string[];
  targetCustomer: string | null;
  photos: LabPhoto[];
};
export type LabBusinessDetail = { id: string; name: string; description: string | null; language: string; colors: string[]; phone: string | null; website: string | null; country: string | null; tone: string | null };

export async function listBusinesses(): Promise<LabBusiness[]> {
  const r = await db().query(
    `select b.id, b.name, count(p.id)::int as products from "Business" b join "Product" p on p."businessId" = b.id and p.status = 'ACTIVE'
     group by b.id, b.name order by b.name`,
  );
  return r.rows;
}

export async function getBusiness(id: string): Promise<LabBusinessDetail | null> {
  const r = await db().query(
    `select id, name, coalesce(description, "industryDescription") as description, "contentLanguage" as language, "brandColors" as colors, phone, website, country, tone
     from "Business" where id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

/** "15,000 RWF", "From 5,000 RWF", "20,000 RWF / month"; null when the price is on request. */
export function priceText(model: string, amount: number | null, currency: string, note: string | null): string | null {
  if (model === "ON_REQUEST" || amount === null) return note || null;
  const value = `${amount.toLocaleString("en-US")} ${currency}`;
  const text = model === "FROM" ? `From ${value}` : model === "PER_MONTH" ? `${value} / month` : model === "PER_YEAR" ? `${value} / year` : model === "PER_UNIT" ? `${value} each` : value;
  return note ? `${text} (${note})` : text;
}

export async function listProducts(businessId: string): Promise<LabProduct[]> {
  const r = await db().query(
    `select p.id, p.name, p.summary, p.description, p."priceModel", p."priceAmount", p.currency, p."priceNote", p.usps, p.features, p."targetCustomer",
       coalesce(json_agg(json_build_object('assetId', a.id, 'width', a.width, 'height', a.height, 'description', a.description) order by pp.position)
         filter (where a.id is not null and a.kind = 'photo'), '[]') as photos
     from "Product" p
     left join "ProductPhoto" pp on pp."productId" = p.id
     left join "MediaAsset" a on a.id = pp."assetId"
     where p."businessId" = $1 and p.status = 'ACTIVE'
     group by p.id order by p."createdAt" desc`,
    [businessId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    summary: row.summary,
    description: row.description,
    price: priceText(row.priceModel, row.priceAmount, row.currency, row.priceNote),
    usps: row.usps ?? [],
    features: row.features ?? [],
    targetCustomer: row.targetCustomer,
    photos: row.photos,
  }));
}

/** The photo, resized (longest side `max` px) to JPEG and cached on disk. Only photos that belong to the business. */
export async function photoJpeg(assetId: string, max: number, businessId?: string): Promise<{ bytes: Buffer; width: number; height: number }> {
  if (!/^[a-z0-9-]{10,40}$/i.test(assetId)) throw new Error("Bad photo id");
  const file = path.join(DATA, "photos", `${assetId}-${max}.jpg`);
  try {
    const bytes = await fs.readFile(file);
    const meta = await sharp(bytes).metadata();
    return { bytes, width: meta.width ?? 0, height: meta.height ?? 0 };
  } catch {
    // Not cached yet.
  }
  const r = await db().query(`select path, "businessId", "mimeType" from "MediaAsset" where id = $1 and kind = 'photo'`, [assetId]);
  const row = r.rows[0];
  if (!row || (businessId && row.businessId !== businessId)) throw new Error("Photo not found");
  const { data, error } = await storage().from("media").download(row.path);
  if (error || !data) throw new Error("Photo could not be downloaded");
  const out = await sharp(Buffer.from(await data.arrayBuffer())).rotate().resize({ width: max, height: max, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer({ resolveWithObject: true });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, out.data);
  return { bytes: out.data, width: out.info.width, height: out.info.height };
}

/** An active library track for the mood (or any), cached on disk; null when the library is empty. */
export async function musicFor(mood: string | null): Promise<{ id: string; title: string } | null> {
  const r = await db().query(
    `select id, title from "MusicTrack" where active order by (case when $1::text = any(moods) then 0 else 1 end), random() limit 1`,
    [mood ?? ""],
  );
  return r.rows[0] ?? null;
}

export async function musicBytes(id: string): Promise<{ bytes: Buffer; mimeType: string }> {
  if (!/^[a-z0-9_-]{6,60}$/i.test(id)) throw new Error("Bad track id");
  const r = await db().query(`select path, "mimeType" from "MusicTrack" where id = $1 and active`, [id]);
  const row = r.rows[0];
  if (!row) throw new Error("Track not found");
  const file = path.join(DATA, "music", `${id}`);
  try {
    return { bytes: await fs.readFile(file), mimeType: row.mimeType };
  } catch {
    // Not cached yet.
  }
  const { data, error } = await storage().from("music").download(row.path);
  if (error || !data) throw new Error("Track could not be downloaded");
  const bytes = Buffer.from(await data.arrayBuffer());
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  return { bytes, mimeType: row.mimeType };
}

/**
 * Keys saved in Admin -> Services (AdminSetting "services.keys", encrypted with ENCRYPTION_KEY) for the lab's
 * services, put in process.env when .env has no value, the same way the app loads them (lib/admin/service-keys.ts).
 * Returns the names loaded (never the values).
 */
export async function loadSavedKeys(names: string[]): Promise<string[]> {
  const r = await db().query(`select value from "AdminSetting" where key = 'services.keys'`);
  const values = (r.rows[0]?.value?.values ?? {}) as Record<string, { enc?: string }>;
  const loaded: string[] = [];
  for (const name of names) {
    if (process.env[name] || !values[name]?.enc) continue;
    try {
      process.env[name] = await decrypt(values[name].enc as string);
      loaded.push(name);
    } catch {
      // Saved with another ENCRYPTION_KEY: left unset, the lab says the key is missing.
    }
  }
  return loaded;
}

export async function closeDb(): Promise<void> {
  await pool?.end().catch(() => undefined);
}
