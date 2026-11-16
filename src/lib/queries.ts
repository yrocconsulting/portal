import "server-only";

/** Ticket columns plus client and assignee names. Two foreign keys point at staff, so name the one we mean. */
export const TICKET_ROW = "*, client:clients(id, name), assignee:staff!tickets_assignee_id_fkey(id, full_name, email)";
