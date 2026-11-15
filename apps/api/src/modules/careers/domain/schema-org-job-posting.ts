// Schema.org JobPosting JSON-LD domain adapter and serializer (T3-044).
// Provides Level 3 integration with public job boards and aggregators
// by normalizing incoming schema.org JobPosting documents into domain Job records
// and serializing domain jobs back into valid schema.org JobPosting JSON-LD.
import type { Job, JobProvenance, JobRecord, ParseJobResult } from './job.ts';

export interface SchemaOrgOrganization {
  readonly '@type': 'Organization';
  readonly name: string;
  readonly sameAs?: string;
}

export interface SchemaOrgPostalAddress {
  readonly '@type': 'PostalAddress';
  readonly addressLocality: string;
  readonly addressRegion?: string;
  readonly postalCode?: string;
  readonly addressCountry?: string;
}

export interface SchemaOrgPlace {
  readonly '@type': 'Place';
  readonly address: SchemaOrgPostalAddress | string;
}

export interface SchemaOrgJobPosting {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'JobPosting';
  readonly identifier?: string;
  readonly title: string;
  readonly description: string;
  readonly datePosted: string;
  readonly validThrough: string;
  readonly hiringOrganization: SchemaOrgOrganization;
  readonly jobLocation: SchemaOrgPlace;
  readonly employmentType?: string;
  readonly occupationalCategory?: string;
  readonly url?: string;
  readonly accessibilityRequirements?: string;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Determines whether an arbitrary input represents a schema.org JobPosting JSON-LD object. */
export function isSchemaOrgJobPosting(input: unknown): boolean {
  if (!isObject(input)) return false;

  const type = input['@type'];
  const hasJobPostingType =
    type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
  if (!hasJobPostingType) return false;

  const context = input['@context'];
  if (typeof context === 'string') {
    return context.includes('schema.org');
  }
  if (Array.isArray(context)) {
    return context.some((c) => typeof c === 'string' && c.includes('schema.org'));
  }
  if (isObject(context)) {
    return true;
  }
  return 'hiringOrganization' in input || 'datePosted' in input || 'validThrough' in input;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;
const URL_PATTERN = /^https?:\/\/\S+$/;
const MAX_TITLE = 200;
const MAX_ORGANIZATION = 200;
const MAX_LOCATION = 200;
const MAX_DESCRIPTION = 20_000;
const MAX_URL = 500;

/**
 * Validates and normalizes a schema.org JobPosting JSON-LD object into a domain Job.
 * Accumulates all validation errors before returning.
 */
export function parseSchemaOrgJobPosting(input: unknown, path = 'job'): ParseJobResult {
  if (!isObject(input)) {
    return { ok: false, errors: [`${path} must be a JSON object`] };
  }

  const errors: string[] = [];

  // 1. Title / Name
  const rawTitle = typeof input.title === 'string' ? input.title : input.name;
  if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
    errors.push(`${path}.title must be a non-empty string`);
  } else if (rawTitle.length > MAX_TITLE) {
    errors.push(`${path}.title is longer than ${MAX_TITLE} characters`);
  }
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';

  // 2. Description
  const rawDesc = input.description;
  if (typeof rawDesc !== 'string' || !rawDesc.trim()) {
    errors.push(`${path}.description must be a non-empty string`);
  } else if (rawDesc.length > MAX_DESCRIPTION) {
    errors.push(`${path}.description is longer than ${MAX_DESCRIPTION} characters`);
  }
  let description = typeof rawDesc === 'string' ? rawDesc.trim() : '';

  // 3. Date Posted
  let postedAt: Date | null = null;
  if (typeof input.datePosted !== 'string' || !input.datePosted.trim()) {
    errors.push(`${path}.datePosted must be a non-empty ISO 8601 date string`);
  } else {
    const timestamp = Date.parse(input.datePosted);
    if (Number.isNaN(timestamp)) {
      errors.push(`${path}.datePosted must be a valid ISO 8601 date string`);
    } else {
      postedAt = new Date(timestamp);
    }
  }

  // 4. Valid Through / Expiry Date
  let expiresAt: Date | null = null;
  const rawValidThrough = input.validThrough ?? input.expiresAt;
  if (typeof rawValidThrough !== 'string' || !rawValidThrough.trim()) {
    errors.push(`${path}.validThrough must be a non-empty ISO 8601 date string`);
  } else {
    const timestamp = Date.parse(rawValidThrough);
    if (Number.isNaN(timestamp)) {
      errors.push(`${path}.validThrough must be a valid ISO 8601 date string`);
    } else {
      expiresAt = new Date(timestamp);
    }
  }

  // 5. Hiring Organization
  let organization = '';
  const hiringOrg = input.hiringOrganization;
  if (typeof hiringOrg === 'string' && hiringOrg.trim()) {
    organization = hiringOrg.trim();
  } else if (isObject(hiringOrg)) {
    const orgName = hiringOrg.name ?? hiringOrg.legalName;
    if (typeof orgName === 'string' && orgName.trim()) {
      organization = orgName.trim();
    } else {
      errors.push(`${path}.hiringOrganization.name must be a non-empty string`);
    }
  } else {
    errors.push(`${path}.hiringOrganization must specify an organization name`);
  }
  if (organization.length > MAX_ORGANIZATION) {
    errors.push(`${path}.hiringOrganization is longer than ${MAX_ORGANIZATION} characters`);
  }

  // 6. Job Location
  let location = '';
  const rawLoc = input.jobLocation ?? input.applicantLocationRequirements;
  if (typeof rawLoc === 'string' && rawLoc.trim()) {
    location = rawLoc.trim();
  } else if (isObject(rawLoc)) {
    const addr = rawLoc.address;
    if (typeof addr === 'string' && addr.trim()) {
      location = addr.trim();
    } else if (isObject(addr)) {
      const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        .map((p) => p.trim());
      if (parts.length > 0) {
        location = parts.join(', ');
      } else if (typeof addr.streetAddress === 'string') {
        location = addr.streetAddress.trim();
      }
    }
    if (!location && typeof rawLoc.name === 'string' && rawLoc.name.trim()) {
      location = rawLoc.name.trim();
    }
  }
  if (!location) {
    location = 'Addis Ababa';
  }
  if (location.length > MAX_LOCATION) {
    errors.push(`${path}.jobLocation is longer than ${MAX_LOCATION} characters`);
  }

  // 7. Employment Type
  let employmentType: string | undefined;
  if (typeof input.employmentType === 'string' && input.employmentType.trim()) {
    employmentType = input.employmentType.trim();
  } else if (Array.isArray(input.employmentType) && input.employmentType.length > 0) {
    employmentType = input.employmentType
      .filter((t) => typeof t === 'string' && t.trim().length > 0)
      .join(', ');
  }

  // 8. Accessibility / Accommodations Notes
  const accessibilityPieces: string[] = [];
  const checkNoteField = (val: unknown) => {
    if (typeof val === 'string' && val.trim()) {
      accessibilityPieces.push(val.trim());
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' && item.trim()) {
          accessibilityPieces.push(item.trim());
        }
      }
    }
  };

  checkNoteField(input.accessibilityNotes);
  checkNoteField(input.accommodationNotes);
  checkNoteField(input.accommodations);
  checkNoteField(input.accessibilityRequirements);
  checkNoteField(input.sensoryRequirement);
  checkNoteField(input.physicalRequirement);

  const accessibilityNotes =
    accessibilityPieces.length > 0 ? accessibilityPieces.join('; ') : undefined;

  if (accessibilityNotes && !description.toLowerCase().includes(accessibilityNotes.toLowerCase())) {
    description += `\n\nAccessibility & Accommodations: ${accessibilityNotes}`;
  }
  if (employmentType && !description.toLowerCase().includes(employmentType.toLowerCase())) {
    description += `\nEmployment Type: ${employmentType}`;
  }

  // 9. Identifier / ID
  let rawId;
  if (typeof input.identifier === 'string' && input.identifier.trim()) {
    rawId = input.identifier.trim();
  } else if (isObject(input.identifier) && typeof input.identifier.value === 'string') {
    rawId = input.identifier.value.trim();
  } else if (typeof input['@id'] === 'string' && input['@id'].trim()) {
    const atId = input['@id'].trim();
    rawId = atId.split('/').pop() ?? atId;
  } else if (typeof input.id === 'string' && input.id.trim()) {
    rawId = input.id.trim();
  }

  let id = '';
  if (rawId) {
    const candidate = slugify(rawId);
    id = ID_PATTERN.test(candidate) ? candidate : `job-${candidate}`;
  }
  if (!id || !ID_PATTERN.test(id)) {
    const derived = slugify(`${organization}-${title}`);
    id = derived ? `job-${derived}`.slice(0, 99) : `job-${Date.now()}`;
  }

  // 10. Category
  let category = 'general';
  const rawCat = input.occupationalCategory ?? input.category ?? input.industry;
  if (typeof rawCat === 'string' && rawCat.trim()) {
    const candidate = slugify(rawCat);
    if (ID_PATTERN.test(candidate)) {
      category = candidate;
    }
  }

  // 11. Source URL
  let sourceUrl: string;
  const rawUrl = input.url ?? input.sameAs ?? input.sourceUrl;
  if (typeof rawUrl === 'string' && rawUrl.trim() && URL_PATTERN.test(rawUrl.trim())) {
    sourceUrl = rawUrl.trim();
  } else if (typeof input['@id'] === 'string' && URL_PATTERN.test(input['@id'].trim())) {
    sourceUrl = input['@id'].trim();
  } else {
    sourceUrl = `https://digitalbridge.et/jobs/${id}`;
  }
  if (sourceUrl.length > MAX_URL) {
    errors.push(`${path}.url is longer than ${MAX_URL} characters`);
  }

  // 12. Version
  const version =
    typeof input.version === 'string' && input.version.trim() ? input.version.trim() : '1.0';

  if (errors.length > 0 || !postedAt || !expiresAt) {
    return { ok: false, errors };
  }

  const provenance: JobProvenance = {
    kind: 'partner',
    source: organization,
    verifiedAt: postedAt.toISOString(),
    note: 'Imported from schema.org JobPosting JSON-LD',
    ...(employmentType ? { employmentType } : {}),
    ...(accessibilityNotes ? { accessibilityNotes } : {}),
  };

  const job: Job = {
    id,
    version,
    title,
    organization,
    category,
    location,
    description,
    sourceUrl,
    postedAt,
    expiresAt,
    withdrawn: input.withdrawn === true,
    provenance,
    ...(employmentType ? { employmentType } : {}),
    ...(accessibilityNotes ? { accessibilityNotes } : {}),
  };

  return { ok: true, job };
}

/** Serializes an authoritative domain JobRecord into a valid schema.org JobPosting JSON-LD object. */
export function toSchemaOrgJobPosting(job: JobRecord): SchemaOrgJobPosting {
  const hiringOrganization: SchemaOrgOrganization = {
    '@type': 'Organization',
    name: job.organization,
    ...(job.sourceUrl ? { sameAs: job.sourceUrl } : {}),
  };

  const jobLocation: SchemaOrgPlace = {
    '@type': 'Place',
    address: {
      '@type': 'PostalAddress',
      addressLocality: job.location,
      addressCountry: 'ET',
    },
  };

  const employmentType =
    job.employmentType ??
    (job.provenance.kind === 'partner' ? job.provenance.employmentType : undefined);

  const accessibilityRequirements =
    job.accessibilityNotes ??
    (job.provenance.kind === 'partner' ? job.provenance.accessibilityNotes : undefined);

  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    identifier: job.id,
    title: job.title,
    description: job.description,
    datePosted: job.postedAt.toISOString(),
    validThrough: job.expiresAt.toISOString(),
    hiringOrganization,
    jobLocation,
    occupationalCategory: job.category,
    url: job.sourceUrl,
    ...(employmentType ? { employmentType } : {}),
    ...(accessibilityRequirements ? { accessibilityRequirements } : {}),
  };
}
