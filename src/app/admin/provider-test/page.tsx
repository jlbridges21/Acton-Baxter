import { redirect } from "next/navigation";

/** Provider Test admin page removed — redirect bookmarks to Baxter Dashboard. */
export default function AdminProviderTestPage() {
  redirect("/");
}
