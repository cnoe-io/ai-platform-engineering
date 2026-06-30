import { redirect } from "next/navigation";

export default function IntegrationsPage() {
  redirect("/credentials?tab=connections");
}
