/** Pure helpers for the Customer Portal (no DB). */
import { z } from "zod";

export const INDIAN_STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal",
  "Andaman and Nicobar Islands","Chandigarh","Dadra and Nagar Haveli and Daman and Diu","Delhi","Jammu and Kashmir","Ladakh","Lakshadweep","Puducherry",
] as const;
export const DG_LOCATIONS = ["Indoor", "Outdoor", "Rooftop", "Basement", "Canopy"] as const;
export const PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Digits only; 10-digit Indian mobiles (also +91 / 91 / 0 prefixed) -> "+91XXXXXXXXXX". Returns null if not a valid mobile. */
export function normalisePhone(raw: string): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? "+91" + d : null;
}
export const last10 = (raw: string): string => String(raw ?? "").replace(/\D/g, "").slice(-10);

export const normaliseEmail = (raw: string): string => String(raw ?? "").trim().toLowerCase();
export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export interface ProductLite { id: string; model: string; capacityKva: number }
/** Exact kVA match; otherwise nearest, rounding UP on ties. Null when the catalogue is empty. */
export function matchProduct(products: ProductLite[], kva: number): { product: ProductLite; exact: boolean } | null {
  if (!products.length) return null;
  const exact = products.find((p) => p.capacityKva === kva);
  if (exact) return { product: exact, exact: true };
  let best = products[0];
  for (const p of products) {
    const d = Math.abs(p.capacityKva - kva), bd = Math.abs(best.capacityKva - kva);
    if (d < bd || (d === bd && p.capacityKva > best.capacityKva)) best = p;
  }
  return { product: best, exact: false };
}

export interface AddressParts { line: string; area?: string; city: string; district?: string; state: string; pincode: string }
export function composeAddress(a: AddressParts): string {
  return [a.line, a.area, a.city, a.district, a.state, a.pincode].map((x) => (x ?? "").trim()).filter(Boolean).join(", ");
}

const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter the contact name").max(120),
  phone: z.string().refine((v) => normalisePhone(v) !== null, "Enter a valid 10-digit mobile number"),
  email: z.string().trim().max(200).optional().refine((v) => !v || looksLikeEmail(v), "Enter a valid e-mail"),
  designation: optText(120),
});

export const siteInputSchema = z
  .object({
    name: z.string().trim().min(1, "Enter the site name").max(160),
    line: z.string().trim().min(1, "Enter the address").max(240),
    area: optText(160),
    city: z.string().trim().min(1, "Enter the city or town").max(120),
    district: optText(120),
    state: z.enum(INDIAN_STATES, { errorMap: () => ({ message: "Choose a state" }) }),
    pincode: z.string().regex(/^\d{6}$/, "Enter a 6-digit PIN code"),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    contacts: z.array(contactSchema).min(1, "Add at least one contact").max(5),
    ratingKva: z.number().positive().max(100000),
    ratingUnsure: z.boolean().optional(),
    dgSets: z.number().int().min(1).max(50).default(1),
    dgModel: optText(160),
    dgLocation: z.enum(DG_LOCATIONS).optional(),
    formalities: z.record(z.string().max(60), z.boolean()).default({}),
    formalityOther: optText(300),
    accessNotes: optText(1000),
    startBy: dateStr.optional(),
    completeBy: dateStr.optional(),
    priority: z.enum(PRIORITIES).default("normal"),
    priorityReason: optText(400),
    /** PortalAttachment ids uploaded during the draft. */
    photoIds: z.array(z.string().max(40)).max(5).default([]),
    documentIds: z.record(z.string().max(60), z.string().max(40)).default({}),
    priorityDocumentId: z.string().max(40).optional(),
  })
  .superRefine((s, ctx) => {
    const need = (p: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path: p, message });
    if ((s.priority === "critical" || s.priority === "high") && !s.priorityReason) need(["priorityReason"], "Give a reason for this priority");
    if (s.priority === "critical" && !s.completeBy) need(["completeBy"], "Critical needs a completion date");
    if (s.startBy && s.completeBy && s.completeBy < s.startBy) need(["completeBy"], "Completion date must be on or after the start date");
  });
export type SiteInput = z.infer<typeof siteInputSchema>;

export const MAX_SITE_ROWS = 200;
export const submissionSchema = z.object({
  submissionKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  customerPoNumber: optText(80),
  customerPoDate: dateStr.optional(),
  notes: optText(2000),
  poAttachmentId: z.string().max(40).optional(),
  sites: z.array(siteInputSchema).min(1).max(MAX_SITE_ROWS),
});
export type SubmissionInput = z.infer<typeof submissionSchema>;

/** One Order+Site is created per DG set. Returns the display name of set n of N. */
export function siteDisplayName(name: string, n: number, of: number): string {
  return of > 1 ? name + " - DG " + n : name;
}
export function expandedSiteCount(sites: { dgSets: number }[]): number {
  return sites.reduce((a, s) => a + s.dgSets, 0);
}

export const orderNumberFor = (year: number, rnd: number): string => "ORD-" + year + "-" + (1000 + Math.floor(rnd * 9000));
export const submissionReference = (year: number, rnd: number): string => "PS-" + year + "-" + String(100000 + Math.floor(rnd * 900000));

/** Priority may be changed by the customer until the site reaches Installing (stage 8). */
export const PRIORITY_EDIT_MAX_SEQ = 7;
export const REOPEN_WINDOW_DAYS = 15;
export function canReopen(status: string, closedAt: Date | null, now = new Date()): boolean {
  if (status !== "closed" || !closedAt) return false;
  return now.getTime() - closedAt.getTime() <= REOPEN_WINDOW_DAYS * 86400_000;
}

/** Complaint category / severity mapping (existing tracker values only). */
export const COMPLAINT_CATEGORY_MAP = {
  delivery: "delivery_delay",
  installation: "erection_commissioning",
  commissioning: "erection_commissioning",
  performance: "non_performance",
} as const;
export const URGENCY_MAP = { normal: "medium", high: "high", critical: "critical" } as const;
