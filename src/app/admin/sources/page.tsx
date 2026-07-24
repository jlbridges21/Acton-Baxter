import { redirect } from "next/navigation";

/** Source Health admin page removed — redirect bookmarks to Baxter Dashboard. */
export default function AdminSourcesPage() {
  redirect("/");
}
