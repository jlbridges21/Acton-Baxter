import { redirect } from "next/navigation";

export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/surveys/${id}/responses`);
}
