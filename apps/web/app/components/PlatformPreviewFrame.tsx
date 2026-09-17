import { PostgresAuthRepository } from "@igd/db";
import { getAuthenticatedActor, getCurrentUser } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { PlatformPreviewControl } from "./PlatformPreviewControl";

export async function PlatformPreviewFrame() {
  const actor = await getAuthenticatedActor();
  if (!actor || actor.role !== "PLATFORM_ADMIN" || actor.mustChangePassword) return null;
  const current = await getCurrentUser();
  const subjects = current?.preview ? [] : await new PostgresAuthRepository(getSql()).listPreviewSubjects(actor);
  return <PlatformPreviewControl preview={current?.preview ?? null} subjects={subjects} />;
}
