import { redirect } from "next/navigation";
import { DASHBOARD_PATH } from "@/lib/domain/areas";

export default function Home() {
  redirect(DASHBOARD_PATH);
}
