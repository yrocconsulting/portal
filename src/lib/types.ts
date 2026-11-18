export const STATUSES = ["new", "in_progress", "waiting", "review", "done", "closed"] as const;
export type TicketStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<TicketStatus, string> = {
  new: "New",
  in_progress: "In progress",
  waiting: "Waiting on client",
  review: "In review",
  done: "Done",
  closed: "Closed",
};
export const OPEN_STATUSES: TicketStatus[] = ["new", "in_progress", "waiting", "review"];

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<TicketPriority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

export const TYPES = ["task", "request", "issue", "onboarding", "report"] as const;
export type TicketType = (typeof TYPES)[number];
export const TYPE_LABEL: Record<TicketType, string> = {
  task: "Task",
  request: "Client request",
  issue: "Issue",
  onboarding: "Onboarding",
  report: "Report",
};

export const CLIENT_STATUSES = ["onboarding", "active", "paused", "former"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  onboarding: "Onboarding",
  active: "Active",
  paused: "Paused",
  former: "Archived",
};

/** Services Yroc sells (matches the website's service catalog). */
export const SERVICES = [
  "AI Search Optimization",
  "SEO",
  "Facebook Ads",
  "AI Visibility Audit",
  "Entity Optimization",
  "Schema & Structured Data",
  "AI Content Optimization",
  "AI Search Reporting",
  "Reputation Management",
  "Website Design",
  "Local SEO",
] as const;

export type Staff = {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "member";
  active: boolean;
  job_title: string | null;
  phone: string | null;
  avatar_path: string | null;
};

export type Client = {
  id: string;
  name: string;
  domain: string | null;
  status: ClientStatus;
  white_label: boolean;
  partner: string | null;
  services: string[];
  city: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  address: string | null;
  industry: string | null;
  package: string | null;
  payment_method: string | null;
  drive_url: string | null;
  locations: string | null;
  start_date: string | null;
  links: Record<string, string>;
  tracking_domain: string | null;
  gsc_site_url: string | null;
  package_id: string | null;
  lead_id: string | null;
  account_manager_id: string | null;
  monthly_fee: number | null;
  checkin_days: number | null;
  created_at: string;
};

export const LINK_FIELDS = [
  ["gbp", "Google Business Profile"],
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["youtube", "YouTube"],
  ["linkedin", "LinkedIn"],
  ["x", "X"],
  ["tiktok", "TikTok"],
  ["yelp", "Yelp"],
] as const;

export const CREDENTIAL_KINDS = [
  ["website", "Website login"],
  ["hosting", "Hosting"],
  ["registrar", "Domain registrar"],
  ["google", "Google account"],
  ["social", "Social media"],
  ["other", "Other"],
] as const;

export type Credential = {
  id: string;
  client_id: string;
  kind: string;
  label: string | null;
  url: string | null;
  username: string | null;
  has_password: boolean;
  notes: string | null;
  updated_at: string;
};

export type Contact = {
  id: string;
  client_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  is_primary: boolean;
};

export type Ticket = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  client_id: string | null;
  contact_id: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  type: TicketType;
  source: "manual" | "email" | "onboarding" | "claude" | "report";
  assignee_id: string | null;
  created_by: string | null;
  due_date: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TicketRow = Ticket & {
  client: { id: string; name: string } | null;
  assignee: { id: string; full_name: string | null; email: string } | null;
};

export type Comment = {
  id: string;
  ticket_id: string;
  author_id: string | null;
  author_kind: "staff" | "email" | "claude" | "system";
  author_name: string | null;
  body: string;
  internal: boolean;
  email_message_id: string | null;
  created_at: string;
};

export type TicketEvent = {
  id: number;
  ticket_id: string;
  actor_id: string | null;
  kind: string;
  data: Record<string, string | null>;
  created_at: string;
};

export type Attachment = {
  id: string;
  ticket_id: string;
  path: string;
  name: string;
  size: number | null;
  content_type: string | null;
  uploaded_by: string | null;
  created_at: string;
};
