import { redirect } from "next/navigation";

/**
 * Reports list was removed as redundant with the Property Research dashboard
 * Recent reports section. Keep a redirect for old bookmarks and Slack links.
 */
export default function ReportsIndexPage() {
  redirect("/dashboard");
}
