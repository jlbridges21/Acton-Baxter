import { redirect } from "next/navigation";

/**
 * Production root route for Acton Property Research.
 * Never render the Create Next App starter UI here.
 */
export default function HomePage() {
  redirect("/login");
}
