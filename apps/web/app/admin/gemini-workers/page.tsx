import { requireCapability } from "@/lib/auth/session";
import { GeminiWorkersMonitor } from "../../components/GeminiWorkersMonitor";

export const metadata = {
  title: "Gemini Workers POC | Admin",
};

export default async function GeminiWorkersPage() {
  await requireCapability("platform:observe");

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <GeminiWorkersMonitor />
    </div>
  );
}
