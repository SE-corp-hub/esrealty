import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const PUBLIC_LISTING_COLUMNS = [
  "id", "ref", "title", "description", "property_type", "offer_type", "status",
  "price", "rent", "display_price", "address", "barangay", "city", "province",
  "region", "postal_code", "latitude", "longitude", "bedrooms", "bathrooms",
  "floor_area_sqm", "floor_area_sqft", "lot_size_sqm", "lot_size_sqft", "year_built",
  "featured", "agent_id", "agent_name", "views", "inquiries", "published_at",
  "updated_at", "images",
].join(",");

const MANAGED_LISTING_COLUMNS = [
  "id", "ref", "title", "description", "property_type", "offer_type", "status",
  "price", "rent", "address", "barangay", "city", "province", "region",
  "postal_code", "latitude", "longitude", "bedrooms", "bathrooms",
  "floor_area_sqm", "lot_size_sqm", "year_built", "featured", "is_published",
  "published_at", "owner_id", "payload", "views", "inquiries", "created_at", "updated_at",
].join(",");

const DEFAULT_SITE_CONTACT = {
  eyebrow: "PROPERTY GUIDANCE",
  title: "What are you planning next?",
  description: "Tell SEA ESTATES whether you are buying, selling, renting, or reviewing a property. Include the location and any questions you would like us to help with.",
  phone: "0905 307 9119",
  email: "seaestate@gmail.com",
  address: "Batangas, Philippines",
  hours: "Monday–Saturday, 9:00 AM–6:00 PM",
};

const propertyTypes = new Set([
  "house-and-lot", "condominium", "lot-only", "townhouse", "shophouse", "commercial",
  "industrial", "agricultural", "foreclosed",
]);
const listingStatuses = new Set([
  "available", "reserved", "pending", "sold", "rented", "rfo", "pre-selling", "withdrawn",
]);
const offerTypes = new Set(["sale", "rent"]);
const publisherRoles = new Set(["super-admin", "broker", "agent"]);

type JsonRecord = Record<string, unknown>;
type AuthContext = { id: string; email: string; role: string };

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...headers, "Content-Type": "application/json; charset=utf-8" },
  });

const stringValue = (value: unknown, max: number, field: string, required = false) => {
  const result = String(value ?? "").trim();
  if (required && !result) throw new HttpError(400, `${field} is required`);
  if (result.length > max) throw new HttpError(400, `${field} is too long`);
  return result;
};

const numberValue = (value: unknown, field: string, min: number, max: number, fallback: number | null) => {
  if (value === undefined || value === null || value === "") return fallback;
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) {
    throw new HttpError(400, `${field} is invalid`);
  }
  return result;
};

const nullableNumberValue = (body: JsonRecord, key: string, field: string, min: number, max: number, fallback: number | null) => {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return fallback;
  if (body[key] === null || body[key] === "") return null;
  return numberValue(body[key], field, min, max, fallback);
};

const booleanValue = (value: unknown, fallback: boolean) => {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new HttpError(400, "Boolean field is invalid");
  return value;
};

const enumValue = (value: unknown, allowed: Set<string>, fallback: string, field: string) => {
  const result = String(value ?? fallback).trim().toLowerCase();
  if (!allowed.has(result)) throw new HttpError(400, `${field} is invalid`);
  return result;
};

const imageUrls = (value: unknown, fallback: string[] = []) => {
  if (value === undefined) value = fallback;
  if (!Array.isArray(value) || value.length > 20) throw new HttpError(400, "images must contain at most 20 URLs");
  const urls = value.map((item) => {
    const candidate = typeof item === "string" ? item : String((item as JsonRecord)?.url || "");
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new HttpError(400, "Every image must have a valid HTTPS URL");
    }
    if (parsed.protocol !== "https:") throw new HttpError(400, "Every image must use HTTPS");
    return parsed.toString();
  });
  return [...new Set(urls)];
};

const parseBody = async (req: Request) => {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 1_000_000) throw new HttpError(413, "Request body is too large");
  if (!req.body) throw new HttpError(400, "Request body is required");
  try {
    const reader = req.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        throw new HttpError(413, "Request body is too large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as JsonRecord;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON request body");
  }
};

const bearerToken = (req: Request) => {
  const header = req.headers.get("Authorization") || "";
  return header.replace(/^Bearer\s+/i, "").trim();
};

const authenticate = async (req: Request, admin: SupabaseClient, required = true): Promise<AuthContext | null> => {
  const token = bearerToken(req);
  if (!token) {
    if (required) throw new HttpError(401, "Authentication required");
    return null;
  }

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    if (required) throw new HttpError(401, "Invalid session");
    return null;
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role,registration_status")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.registration_status !== "approved") {
    if (required) throw new HttpError(403, "Approved account required");
    return null;
  }

  return {
    id: authData.user.id,
    email: authData.user.email || "",
    role: String(profile.role || ""),
  };
};

const listingInput = (body: JsonRecord, existing: JsonRecord | null, ownerId: string) => {
  const oldPayload = existing?.payload && typeof existing.payload === "object"
    ? existing.payload as JsonRecord
    : {};
  const id = String(existing?.id || `lst-${crypto.randomUUID()}`);
  const now = new Date().toISOString();
  const title = stringValue(body.title ?? existing?.title, 180, "title", true);
  const description = stringValue(body.description ?? existing?.description, 10_000, "description");
  const propertyType = enumValue(body.property_type ?? existing?.property_type, propertyTypes, "house-and-lot", "property_type");
  const offerType = enumValue(body.offer_type ?? existing?.offer_type, offerTypes, "sale", "offer_type");
  const status = enumValue(body.status ?? existing?.status, listingStatuses, "available", "status");
  const price = numberValue(body.price, "price", 0, 9_999_999_999_999.99, Number(existing?.price || 0)) || 0;
  const rent = numberValue(body.rent, "rent", 0, 9_999_999_999_999.99, Number(existing?.rent || 0)) || 0;
  const address = stringValue(body.address ?? existing?.address, 500, "address");
  const barangay = stringValue(body.barangay ?? existing?.barangay, 120, "barangay");
  const city = stringValue(body.city ?? existing?.city, 120, "city");
  const province = stringValue(body.province ?? existing?.province, 120, "province");
  const region = stringValue(body.region ?? existing?.region, 120, "region");
  const postalCode = stringValue(body.postal_code ?? existing?.postal_code, 20, "postal_code");
  const latitude = nullableNumberValue(body, "latitude", "latitude", -90, 90, existing?.latitude == null ? null : Number(existing.latitude));
  const longitude = nullableNumberValue(body, "longitude", "longitude", -180, 180, existing?.longitude == null ? null : Number(existing.longitude));
  const bedrooms = numberValue(body.bedrooms, "bedrooms", 0, 100, Number(existing?.bedrooms || 0)) || 0;
  const bathrooms = numberValue(body.bathrooms, "bathrooms", 0, 99.9, Number(existing?.bathrooms || 0)) || 0;
  const floorArea = nullableNumberValue(body, "floor_area_sqm", "floor_area_sqm", 0, 9_999_999_999.99, existing?.floor_area_sqm == null ? null : Number(existing.floor_area_sqm));
  const lotSize = nullableNumberValue(body, "lot_size_sqm", "lot_size_sqm", 0, 9_999_999_999.99, existing?.lot_size_sqm == null ? null : Number(existing.lot_size_sqm));
  const yearBuilt = nullableNumberValue(body, "year_built", "year_built", 1600, 2200, existing?.year_built == null ? null : Number(existing.year_built));
  const featured = booleanValue(body.featured, Boolean(existing?.featured));
  const isPublished = booleanValue(body.is_published, Boolean(existing?.is_published));
  const oldImages = Array.isArray(oldPayload.photos) ? oldPayload.photos.map(String) : [];
  const photos = imageUrls(body.images, oldImages);
  const ref = stringValue(body.ref || existing?.ref || `LST-${id.slice(-8).toUpperCase()}`, 40, "ref", true);
  const details = body.details && typeof body.details === "object" && !Array.isArray(body.details) ? body.details as JsonRecord : {};
  const financingAllowed = new Set(["cash", "bank", "inhouse", "pagibig", "developer"]);
  const financingInput = (details.financing === undefined ? oldPayload.financing : details.financing) || [];
  if (!Array.isArray(financingInput) || financingInput.length > 5 || financingInput.some((item) => !financingAllowed.has(String(item)))) {
    throw new HttpError(400, "details.financing is invalid");
  }
  const videoUrl = stringValue(details.video_url ?? oldPayload.videoUrl, 1000, "details.video_url");
  if (videoUrl) {
    try { if (new URL(videoUrl).protocol !== "https:") throw new Error(); }
    catch { throw new HttpError(400, "details.video_url must be a valid HTTPS URL"); }
  }

  const payload = {
    ...oldPayload,
    id,
    ref,
    title,
    description,
    propertyType,
    dealType: offerType,
    status,
    price,
    rent,
    address,
    barangay,
    city,
    province,
    region,
    postalCode,
    lat: latitude == null ? "" : String(latitude),
    lng: longitude == null ? "" : String(longitude),
    bedrooms,
    bathrooms,
    floorArea,
    lotArea: lotSize,
    yearBuilt,
    featured,
    photos,
    parking: numberValue(details.parking, "details.parking", 0, 100, Number(oldPayload.parking || 0)),
    floors: numberValue(details.floors, "details.floors", 0, 200, Number(oldPayload.floors || 0)),
    financing: financingInput.map(String),
    titleType: stringValue(details.title_type ?? oldPayload.titleType, 40, "details.title_type"),
    titleNo: stringValue(details.title_no ?? oldPayload.titleNo, 160, "details.title_no"),
    taxDecNo: stringValue(details.tax_dec_no ?? oldPayload.taxDecNo, 160, "details.tax_dec_no"),
    zoning: stringValue(details.zoning ?? oldPayload.zoning, 120, "details.zoning"),
    turnoverDate: stringValue(details.turnover_date ?? oldPayload.turnoverDate, 120, "details.turnover_date"),
    developer: stringValue(details.developer ?? oldPayload.developer, 180, "details.developer"),
    licenseToSell: stringValue(details.license_to_sell ?? oldPayload.licenseToSell, 180, "details.license_to_sell"),
    hoaDues: numberValue(details.hoa_dues, "details.hoa_dues", 0, 99_999_999.99, Number(oldPayload.hoaDues || 0)),
    condoDues: numberValue(details.condo_dues, "details.condo_dues", 0, 99_999_999.99, Number(oldPayload.condoDues || 0)),
    videoUrl,
    createdBy: ownerId,
    createdAt: String(oldPayload.createdAt || existing?.created_at || now),
    updatedAt: now,
  };

  return {
    id,
    ref,
    title,
    description,
    property_type: propertyType,
    offer_type: offerType,
    status,
    price,
    rent,
    address,
    barangay,
    city,
    province,
    region,
    postal_code: postalCode,
    latitude,
    longitude,
    bedrooms: Math.trunc(bedrooms),
    bathrooms,
    floor_area_sqm: floorArea,
    lot_size_sqm: lotSize,
    year_built: yearBuilt == null ? null : Math.trunc(yearBuilt),
    featured,
    is_published: isPublished,
    owner_id: ownerId,
    payload,
    updated_at: now,
  };
};

const requirePublisher = (auth: AuthContext) => {
  if (!publisherRoles.has(auth.role)) throw new HttpError(403, "Agent or administrator access required");
};

const listListings = async (url: URL, admin: SupabaseClient) => {
  const page = Number(url.searchParams.get("page") || 1);
  const perPage = Number(url.searchParams.get("per_page") || 12);
  if (!Number.isInteger(page) || page < 1) throw new HttpError(400, "page must be a positive integer");
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 50) throw new HttpError(400, "per_page must be between 1 and 50");
  const from = (page - 1) * perPage;
  let query = admin.from("public_listing_catalog").select(PUBLIC_LISTING_COLUMNS, { count: "exact" });

  const city = stringValue(url.searchParams.get("city"), 120, "city");
  const region = stringValue(url.searchParams.get("region"), 120, "region");
  const state = stringValue(url.searchParams.get("state"), 120, "state");
  const propertyType = stringValue(url.searchParams.get("property_type"), 60, "property_type");
  const offerType = stringValue(url.searchParams.get("offer_type"), 20, "offer_type");
  const status = stringValue(url.searchParams.get("status"), 30, "status");
  const minPrice = numberValue(url.searchParams.get("min_price"), "min_price", 0, 9_999_999_999_999.99, null);
  const maxPrice = numberValue(url.searchParams.get("max_price"), "max_price", 0, 9_999_999_999_999.99, null);
  const beds = numberValue(url.searchParams.get("beds"), "beds", 0, 100, null);
  const baths = numberValue(url.searchParams.get("baths"), "baths", 0, 99.9, null);

  if (city) query = query.ilike("city", city);
  if (region) query = query.ilike("region", region);
  if (state) query = query.ilike("province", state);
  if (propertyType) query = query.eq("property_type", enumValue(propertyType, propertyTypes, "", "property_type"));
  if (offerType) query = query.eq("offer_type", enumValue(offerType, offerTypes, "", "offer_type"));
  if (status) query = query.eq("status", enumValue(status, listingStatuses, "", "status"));
  if (minPrice != null) query = query.gte("display_price", minPrice);
  if (maxPrice != null) query = query.lte("display_price", maxPrice);
  if (beds != null) query = query.gte("bedrooms", beds);
  if (baths != null) query = query.gte("bathrooms", baths);
  if (url.searchParams.get("featured") === "true") query = query.eq("featured", true);

  const sort = url.searchParams.get("sort") || "date_desc";
  if (sort === "price_asc") query = query.order("display_price", { ascending: true });
  else if (sort === "price_desc") query = query.order("display_price", { ascending: false });
  else if (sort === "date_asc") query = query.order("published_at", { ascending: true });
  else if (sort === "date_desc") query = query.order("published_at", { ascending: false });
  else throw new HttpError(400, "sort is invalid");

  const { data, error, count } = await query.range(from, from + perPage - 1);
  if (error) throw new Error(error.message);
  const total = Number(count || 0);
  return json({ data: data || [], page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) });
};

const getListing = async (req: Request, id: string, admin: SupabaseClient, pepper: string) => {
  const { data, error } = await admin
    .from("public_listing_catalog")
    .select(PUBLIC_LISTING_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, "Listing not found");
  // One view per visitor per listing per day: the limiter remembers who already counted.
  const viewKey = await sha256(`${pepper}:view:${id}:${callerAddress(req)}`);
  const { data: firstToday, error: seenError } = await admin.rpc("consume_listing_inquiry_rate_limit", {
    p_request_key_hash: viewKey,
    p_limit: 1,
    p_window_seconds: 86400,
  });
  if (seenError) console.error(seenError);
  if (firstToday) {
    const { error: viewError } = await admin.rpc("increment_public_listing_view", { p_listing_id: id });
    if (viewError) console.error(viewError);
  }
  return json({ data });
};

const createListing = async (req: Request, admin: SupabaseClient) => {
  const auth = await authenticate(req, admin) as AuthContext;
  requirePublisher(auth);
  const body = await parseBody(req);
  const record = listingInput(body, null, auth.id);
  const { data, error } = await admin.from("shared_listings").insert(record).select(MANAGED_LISTING_COLUMNS).single();
  if (error) {
    console.error(error);
    throw new HttpError(error.code === "23505" ? 409 : 400, error.code === "23505" ? "Listing already exists" : "Could not create listing");
  }
  return json({ data: { ...data, payload: undefined } }, 201);
};

const updateListing = async (req: Request, id: string, admin: SupabaseClient) => {
  const auth = await authenticate(req, admin) as AuthContext;
  requirePublisher(auth);
  const { data: existing, error: findError } = await admin
    .from("shared_listings")
    .select(MANAGED_LISTING_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (findError) throw new Error(findError.message);
  if (!existing) throw new HttpError(404, "Listing not found");
  if (auth.role !== "super-admin" && existing.owner_id !== auth.id) {
    throw new HttpError(403, "Only the listing owner or an administrator can update this listing");
  }
  const body = await parseBody(req);
  const record = listingInput(body, existing, String(existing.owner_id));
  const { data, error } = await admin
    .from("shared_listings")
    .update(record)
    .eq("id", id)
    .select(MANAGED_LISTING_COLUMNS)
    .single();
  if (error) {
    console.error(error);
    throw new HttpError(400, "Could not update listing");
  }
  return json({ data: { ...data, payload: undefined } });
};

const deleteListing = async (req: Request, id: string, admin: SupabaseClient) => {
  const auth = await authenticate(req, admin) as AuthContext;
  requirePublisher(auth);
  const { data: existing, error: findError } = await admin
    .from("shared_listings")
    .select("id,owner_id")
    .eq("id", id)
    .maybeSingle();
  if (findError) throw new Error(findError.message);
  if (!existing) throw new HttpError(404, "Listing not found");
  if (auth.role !== "super-admin" && existing.owner_id !== auth.id) {
    throw new HttpError(403, "Only the listing owner or an administrator can delete this listing");
  }
  const { error } = await admin.from("shared_listings").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return json({ ok: true });
};

const toggleFavorite = async (req: Request, id: string, admin: SupabaseClient) => {
  const auth = await authenticate(req, admin) as AuthContext;
  const { data: saved, error } = await admin.rpc("toggle_saved_listing_for_user", {
    p_user_id: auth.id,
    p_listing_id: id,
  });
  if (error) {
    if (/listing not found/i.test(error.message || "")) throw new HttpError(404, "Listing not found");
    throw new Error(error.message);
  }
  return json({ saved: Boolean(saved) });
};

const getManagedListings = async (req: Request, url: URL, admin: SupabaseClient) => {
  const auth = await authenticate(req, admin) as AuthContext;
  requirePublisher(auth);
  const page = Number(url.searchParams.get("page") || 1);
  const perPage = Number(url.searchParams.get("per_page") || 20);
  if (!Number.isInteger(page) || page < 1) throw new HttpError(400, "page must be a positive integer");
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 50) throw new HttpError(400, "per_page must be between 1 and 50");
  const from = (page - 1) * perPage;
  let query = admin.from("shared_listings").select(MANAGED_LISTING_COLUMNS, { count: "exact" });
  if (auth.role !== "super-admin") query = query.eq("owner_id", auth.id);
  const { data, error, count } = await query.order("updated_at", { ascending: false }).range(from, from + perPage - 1);
  if (error) throw new Error(error.message);
  const total = Number(count || 0);
  return json({ data: data || [], page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) });
};

const getFavorites = async (req: Request, admin: SupabaseClient) => {
  const auth = await authenticate(req, admin) as AuthContext;
  const { data: saved, error: savedError } = await admin
    .from("saved_listings")
    .select("listing_id,created_at")
    .eq("user_id", auth.id)
    .order("created_at", { ascending: false });
  if (savedError) throw new Error(savedError.message);
  if (!saved?.length) return json({ data: [] });

  const ids = saved.map((item) => item.listing_id);
  const { data, error } = await admin.from("public_listing_catalog").select(PUBLIC_LISTING_COLUMNS).in("id", ids);
  if (error) throw new Error(error.message);
  const byId = new Map((data || []).map((listing) => [listing.id, listing]));
  return json({ data: ids.map((id) => byId.get(id)).filter(Boolean) });
};

const getSiteSettings = async (admin: SupabaseClient) => {
  const { data: adminProfile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "super-admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!adminProfile) return json({ data: { ...DEFAULT_SITE_CONTACT, valueGuide: {
    version: "2026.09.4", approvedBy: "", approvedAt: "",
    proxyFactors: { residential: 1, commercial: 1.7, agricultural: 0.5, industrial: 1.35 },
    marketBandMid: { residential: 2.5, commercial: 2.5, agricultural: 1.5, industrial: 2 },
    construction: { wood_prefab: 16000, mixed_chb: 25000, rca_steel: 32000 },
  } } });

  const { data: appState, error: stateError } = await admin
    .from("app_state")
    .select("payload")
    .eq("owner_id", adminProfile.id)
    .maybeSingle();
  if (stateError) throw new Error(stateError.message);
  const saved = appState?.payload && typeof appState.payload === "object" && !Array.isArray(appState.payload)
    ? (appState.payload as JsonRecord).siteContact
    : null;
  const savedGuide = appState?.payload && typeof appState.payload === "object" && !Array.isArray(appState.payload)
    ? (appState.payload as JsonRecord).valueGuide
    : null;
  const contact = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as JsonRecord : {};
  const guide = savedGuide && typeof savedGuide === "object" && !Array.isArray(savedGuide) ? savedGuide as JsonRecord : {};
  const proxy = guide.proxyFactors && typeof guide.proxyFactors === "object" ? guide.proxyFactors as JsonRecord : {};
  const mid = guide.marketBandMid && typeof guide.marketBandMid === "object" ? guide.marketBandMid as JsonRecord : {};
  const construction = guide.construction && typeof guide.construction === "object" ? guide.construction as JsonRecord : {};
  const safeNumber = (value: unknown, fallback: number, min: number, max: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const valueGuide = {
    version: stringValue(guide.version || "2026.09.4", 40, "valueGuide.version"),
    approvedBy: stringValue(guide.approvedBy || "", 160, "valueGuide.approvedBy"),
    approvedAt: stringValue(guide.approvedAt || "", 40, "valueGuide.approvedAt"),
    proxyFactors: {
      residential: safeNumber(proxy.residential, 1, 0.1, 10), commercial: safeNumber(proxy.commercial, 1.7, 0.1, 10),
      agricultural: safeNumber(proxy.agricultural, 0.5, 0.1, 10), industrial: safeNumber(proxy.industrial, 1.35, 0.1, 10),
    },
    marketBandMid: {
      residential: safeNumber(mid.residential, 2.5, 0.1, 10), commercial: safeNumber(mid.commercial, 2.5, 0.1, 10),
      agricultural: safeNumber(mid.agricultural, 1.5, 0.1, 10), industrial: safeNumber(mid.industrial, 2, 0.1, 10),
    },
    construction: {
      wood_prefab: safeNumber(construction.wood_prefab, 16000, 1000, 200000), mixed_chb: safeNumber(construction.mixed_chb, 25000, 1000, 200000), rca_steel: safeNumber(construction.rca_steel, 32000, 1000, 200000),
    },
  };
  return json({ data: { ...DEFAULT_SITE_CONTACT, ...contact, valueGuide } });
};

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

// The caller's address as Cloudflare / Supabase report it (for rate limits only).
const callerAddress = (req: Request) => req.headers.get("cf-connecting-ip")
  || req.headers.get("x-real-ip")
  || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
  || "unknown";

const submitInquiry = async (req: Request, id: string, admin: SupabaseClient, pepper: string) => {
  const body = await parseBody(req);
  const fullName = stringValue(body.full_name, 160, "full_name", true);
  const phone = stringValue(body.phone, 50, "phone", true);
  const email = stringValue(body.email, 254, "email").toLowerCase();
  const contactType = stringValue(body.contact_type || "buyer", 40, "contact_type");
  const message = stringValue(body.message, 5000, "message");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "email is invalid");
  if (body.consent !== true) throw new HttpError(400, "Privacy consent is required");

  const { data: listing, error: listingError } = await admin
    .from("public_listing_catalog")
    .select("id,title,agent_id,agent_name")
    .eq("id", id)
    .maybeSingle();
  if (listingError) throw new Error(listingError.message);
  if (!listing) throw new HttpError(404, "Listing not found");

  const optionalUser = await authenticate(req, admin, false);
  // Each form has its own allowance, so a contact form doesn't use up listing inquiries.
  const keyHash = await sha256(`${pepper}:inquiry:${callerAddress(req)}:${optionalUser?.id || "public"}`);
  const { data: permitted, error: rateError } = await admin.rpc("consume_listing_inquiry_rate_limit", {
    p_request_key_hash: keyHash,
    p_limit: 5,
    p_window_seconds: 3600,
  });
  if (rateError) throw new Error(rateError.message);
  if (!permitted) throw new HttpError(429, "Too many inquiries. Please try again later");

  const inquiry = {
    listing_id: id,
    user_id: optionalUser?.id || null,
    full_name: fullName,
    email,
    phone,
    contact_type: contactType,
    message,
    consent_at: new Date().toISOString(),
    source: "website-api",
    metadata: { userAgent: stringValue(req.headers.get("user-agent"), 500, "user-agent") },
  };
  const { data: created, error: inquiryError } = await admin
    .from("listing_inquiries")
    .insert(inquiry)
    .select("id,created_at")
    .single();
  if (inquiryError) throw new Error(inquiryError.message);

  // Route the inquiry to the representative attached to this listing while
  // listing_inquiries remains the canonical public form submission. This is
  // best-effort for projects without crm_leads.
  const leadId = `lead-${crypto.randomUUID()}`;
  const leadPayload = {
    id: leadId,
    ref: `WEB-${leadId.slice(-8).toUpperCase()}`,
    name: fullName,
    phone,
    email,
    type: contactType,
    source: "listing",
    status: "new",
    consent: true,
    propertyInterest: listing.title,
    listingId: listing.id,
    listingTitle: listing.title,
    notes: message || "Inquiry from listing API.",
    assignedTo: listing.agent_name || "",
    assignedToId: listing.agent_id,
    createdBy: listing.agent_id,
    createdAt: created.created_at,
    updatedAt: created.created_at,
    activity: [{ date: created.created_at, text: `Inquiry submitted from listing: ${listing.title}` }],
  };
  const { error: leadError } = await admin.from("crm_leads").insert({
    id: leadId,
    ref: leadPayload.ref,
    name: fullName,
    assigned_to: listing.agent_name || "",
    assigned_to_id: listing.agent_id,
    payload: leadPayload,
    created_by: listing.agent_id,
  });
  if (!leadError) {
    await admin.from("listing_inquiries").update({ crm_lead_id: leadId }).eq("id", created.id);
  }

  return json({ id: created.id, message: "Inquiry submitted" }, 201);
};

const submitContact = async (req: Request, admin: SupabaseClient, pepper: string) => {
  const body = await parseBody(req);
  const inquiryType = String(body.inquiry_type || "consult").trim().toLowerCase();
  // What each public form records on the CRM lead.
  const CONTACT_TYPES: Record<string, { interest: string; activity: string; phone: boolean; email: boolean }> = {
    "consult": { interest: "Shophouse consultation", activity: "Consultation request submitted from the website.", phone: true, email: false },
    "guide": { interest: "Shophouse investment guide", activity: "Investment guide request submitted from the website.", phone: false, email: true },
    "project-bt": { interest: "Project B.T inquiry", activity: "Project B.T inquiry submitted from the website.", phone: false, email: true },
    "location-analysis": { interest: "Location analysis full report", activity: "Value Guide report requested from the website.", phone: false, email: true },
    "professional-appraisal-request": { interest: "Professional appraisal (Value Guide)", activity: "Appraisal consultation requested from the Value Guide.", phone: true, email: true },
    "broker-consultation": { interest: "Broker consultation (Value Guide)", activity: "Broker consultation requested from the Value Guide.", phone: true, email: true },
  };
  const kind = Object.prototype.hasOwnProperty.call(CONTACT_TYPES, inquiryType) ? CONTACT_TYPES[inquiryType] : null;
  if (!kind) throw new HttpError(400, "inquiry_type is invalid");
  const isGuide = inquiryType === "guide";
  const isProjectBt = inquiryType === "project-bt";
  const fullName = isGuide ? "" : stringValue(body.full_name, 160, "full_name", true);
  const phone = isGuide ? "" : stringValue(body.phone, 50, "phone", kind.phone);
  const email = stringValue(body.email, 254, "email");
  const message = stringValue(body.message, 5000, "message");
  if (kind.email && !email) throw new HttpError(400, "email is required");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "email is invalid");
  const interest = isProjectBt ? stringValue(body.interest, 200, "interest") : "";

  const optionalUser = await authenticate(req, admin, false);
  const keyHash = await sha256(`${pepper}:contact:${inquiryType}:${callerAddress(req)}:${optionalUser?.id || "public"}`);
  const { data: permitted, error: rateError } = await admin.rpc("consume_listing_inquiry_rate_limit", {
    p_request_key_hash: keyHash,
    p_limit: 10,
    p_window_seconds: 3600,
  });
  if (rateError) throw new Error(rateError.message);
  if (!permitted) throw new HttpError(429, "Too many requests. Please try again later");

  const now = new Date().toISOString();
  const userAgent = stringValue(req.headers.get("user-agent"), 500, "user-agent");

  // Frontend submissions land in the CRM owned by the super-admin account so
  // brokers/agents never see them — only super admins do.
  const { data: adminAccount, error: adminError } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "super-admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (adminError || !adminAccount) throw new HttpError(500, "No super-admin account is configured");

  const leadId = `lead-${crypto.randomUUID()}`;
  const ref = `CT-${leadId.slice(-8).toUpperCase()}`;
  const lead = {
    id: leadId,
    ref,
    name: fullName || email || "Website lead",
    assigned_to: "",
    assigned_to_id: null,
    created_by: adminAccount.id,
    updated_at: now,
    payload: {
      id: leadId,
      ref,
      name: fullName || email || "Website lead",
      phone,
      email,
      type: isGuide ? "investor" : "buyer",
      source: "website",
      status: "new",
      consent: true,
      origin: "storefront",
      channel: inquiryType,
      propertyInterest: isProjectBt ? (interest || kind.interest) : kind.interest,
      notes: isGuide ? "Download the Shophouse Investment Guide" : message,
      assignedTo: "",
      assignedToId: null,
      createdBy: adminAccount.id,
      createdAt: now,
      updatedAt: now,
      activity: [{ date: now, text: kind.activity }],
    },
  };
  const { error: leadError } = await admin.from("crm_leads").insert(lead);
  if (leadError) throw new Error(leadError.message);

  // Audit copy in the storefront archive (super-admin read only). The lead is
  // already saved, so a failed copy is logged rather than failing the request.
  try {
    const { error: auditError } = await admin.from("storefront_inquiries").insert({
      inquiry_type: inquiryType,
      user_id: optionalUser?.id || null,
      full_name: fullName,
      email,
      phone,
      message,
      consent_at: now,
      source: "website",
      metadata: { userAgent, crmLeadId: leadId },
    });
    if (auditError) console.error("storefront_inquiries audit insert failed", auditError.message);
  } catch (error) {
    console.error(error);
  }

  return json({ id: leadId, message: "Inquiry submitted" }, 201);
};

const routeParts = (url: URL) => {
  let parts: string[];
  try {
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new HttpError(400, "Invalid request path");
  }
  const functionIndex = parts.lastIndexOf("listing-api");
  const route = functionIndex >= 0 ? parts.slice(functionIndex + 1) : parts;
  if (route[0] === "api") route.shift();
  return route;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration is incomplete" }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const pepper = Deno.env.get("INQUIRY_RATE_LIMIT_SALT") || serviceRoleKey.slice(-32);

  try {
    const parts = routeParts(new URL(req.url));
    if (parts.length === 1 && parts[0] === "listings" && req.method === "GET") {
      return await listListings(new URL(req.url), admin);
    }
    if (parts.length === 1 && parts[0] === "listings" && req.method === "POST") {
      return await createListing(req, admin);
    }
    if (parts.length === 2 && parts[0] === "listings" && req.method === "GET") {
      return await getListing(req, parts[1], admin, pepper);
    }
    if (parts.length === 2 && parts[0] === "listings" && req.method === "PUT") {
      return await updateListing(req, parts[1], admin);
    }
    if (parts.length === 2 && parts[0] === "listings" && req.method === "DELETE") {
      return await deleteListing(req, parts[1], admin);
    }
    if (parts.length === 3 && parts[0] === "listings" && parts[2] === "favorite" && req.method === "POST") {
      return await toggleFavorite(req, parts[1], admin);
    }
    if (parts.length === 3 && parts[0] === "listings" && parts[2] === "inquiries" && req.method === "POST") {
      return await submitInquiry(req, parts[1], admin, pepper);
    }
    if (parts.join("/") === "users/me/favorites" && req.method === "GET") {
      return await getFavorites(req, admin);
    }
    if (parts.join("/") === "users/me/listings" && req.method === "GET") {
      return await getManagedListings(req, new URL(req.url), admin);
    }
    if (parts.length === 1 && parts[0] === "site-settings" && req.method === "GET") {
      return await getSiteSettings(admin);
    }
    if (parts.length === 1 && parts[0] === "contacts" && req.method === "POST") {
      return await submitContact(req, admin, pepper);
    }
    throw new HttpError(404, "Endpoint not found");
  } catch (error) {
    if (error instanceof HttpError) {
      const headers = error.status === 429 ? { "Retry-After": "3600" } : {};
      return json({ error: error.message }, error.status, headers);
    }
    console.error(error);
    return json({ error: "Internal server error" }, 500);
  }
});
