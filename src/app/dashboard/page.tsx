import { redirect } from "next/navigation";

/** Property Research moved to /property-research. Kept for old bookmarks and links. */
export default function DashboardRedirectPage() {
  redirect("/property-research");
}
