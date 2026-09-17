import { assertCapability, type AuthorizationContext } from "@igd/auth";
import type { Sql } from "postgres";

export type PlatformObservability = {
  schemaVersion: string;
  analysisWorkers: Array<{
    workerId: string;
    status: string;
    concurrency: number;
    releaseSha: string | null;
    lastErrorCode: string | null;
    lastSeenAt: string;
  }>;
  driveWorkers: Array<{
    workerId: string;
    status: string;
    releaseSha: string | null;
    lastErrorCode: string | null;
    lastSeenAt: string;
  }>;
  driveDiscovery: {
    cursorConfigured: boolean;
    bootstrapCompletedAt: string | null;
    lastChangesScanAt: string | null;
    lastSharedWithMeScanAt: string | null;
    leaseActive: boolean;
    leaseExpiresAt: string | null;
  };
  jobs: Array<{ status: string; stage: string; count: number; retryable: number }>;
  recentErrors: Array<{ subsystem: "analysis" | "drive" | "organization"; code: string; count: number }>;
  organizationSync: {
    status: string;
    revision: string | null;
    errorCode: string | null;
    warningCount: number;
    startedAt: string;
    finishedAt: string | null;
  } | null;
};

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;
const safeCode = (value: string | null): string | null => value === null
  ? null
  : /^[a-zA-Z0-9_.:-]{1,120}$/.test(value) ? value : "unclassified_error";
const safeWorkerId = (value: string): string => /^[a-zA-Z0-9_.:-]{1,120}$/.test(value) ? value : "worker";
const safeReleaseSha = (value: string | null): string | null => value && /^[a-fA-F0-9]{7,64}$/.test(value) ? value : null;

export class PostgresPlatformObservabilityRepository {
  constructor(readonly sql: Sql) {}

  async getOverview(actor: AuthorizationContext): Promise<PlatformObservability> {
    assertCapability(actor, "platform:observe");
    const [analysisWorkers, driveWorkers, discoveryRows, jobs, errors, syncRows] = await Promise.all([
      this.sql<{
        worker_id: string;status: string;concurrency: number;release_sha: string | null;
        last_error_code: string | null;last_seen_at: Date;
      }[]>`
        select worker_id,status,concurrency,release_sha,last_error_code,last_seen_at
        from analysis_worker_heartbeats order by last_seen_at desc
      `,
      this.sql<{
        worker_id: string;status: string;release_sha: string | null;last_error_code: string | null;last_seen_at: Date;
      }[]>`
        select worker_id,status,release_sha,last_error_code,last_seen_at
        from drive_discovery_heartbeats order by last_seen_at desc
      `,
      this.sql<{
        has_cursor: boolean;bootstrap_completed_at: Date | null;last_changes_scan_at: Date | null;
        last_shared_with_me_scan_at: Date | null;lease_active: boolean;lease_expires_at: Date | null;
      }[]>`
        select changes_page_token is not null has_cursor,bootstrap_completed_at,last_changes_scan_at,
          last_shared_with_me_scan_at,coalesce(lease_expires_at>now(),false) lease_active,lease_expires_at
        from drive_discovery_state where id='google_oauth_principal'
      `,
      this.sql<{ status: string;stage: string;count: number;retryable: number }[]>`
        select status,stage,count(*)::integer count,
          count(*) filter(where status='retry_wait')::integer retryable
        from analysis_jobs group by status,stage order by status,stage
      `,
      this.sql<{ subsystem: "analysis" | "drive" | "organization";code: string;count: number }[]>`
        select subsystem,code,count(*)::integer count from (
          select 'analysis'::text subsystem,last_error_code code from analysis_jobs
            where last_error_code is not null and updated_at>now()-interval '7 days'
          union all
          select 'drive',last_error_code from drive_discovery_heartbeats where last_error_code is not null
          union all
          select 'organization',error_code from organization_sync_runs
            where error_code is not null and started_at>now()-interval '7 days'
        ) recent group by subsystem,code order by subsystem,count desc,code
      `,
      this.sql<{
        status: string;spreadsheet_revision: string | null;error_code: string | null;warning_count: number;
        started_at: Date;finished_at: Date | null;
      }[]>`
        select status,spreadsheet_revision,error_code,warning_count,started_at,finished_at
        from organization_sync_runs order by started_at desc limit 1
      `,
    ]);
    const discovery = discoveryRows[0];
    const sync = syncRows[0];
    return {
      schemaVersion: "012_platform_admin_preview",
      analysisWorkers: analysisWorkers.map((row) => ({
        workerId: safeWorkerId(row.worker_id),status: row.status,concurrency: row.concurrency,releaseSha: safeReleaseSha(row.release_sha),
        lastErrorCode: safeCode(row.last_error_code),lastSeenAt: row.last_seen_at.toISOString(),
      })),
      driveWorkers: driveWorkers.map((row) => ({
        workerId: safeWorkerId(row.worker_id),status: row.status,releaseSha: safeReleaseSha(row.release_sha),lastErrorCode: safeCode(row.last_error_code),
        lastSeenAt: row.last_seen_at.toISOString(),
      })),
      driveDiscovery: {
        cursorConfigured: discovery?.has_cursor ?? false,
        bootstrapCompletedAt: iso(discovery?.bootstrap_completed_at ?? null),
        lastChangesScanAt: iso(discovery?.last_changes_scan_at ?? null),
        lastSharedWithMeScanAt: iso(discovery?.last_shared_with_me_scan_at ?? null),
        leaseActive: discovery?.lease_active ?? false,
        leaseExpiresAt: iso(discovery?.lease_expires_at ?? null),
      },
      jobs,
      recentErrors: errors.map((error) => ({ ...error,code: safeCode(error.code) ?? "unclassified_error" })),
      organizationSync: sync ? {
        status: sync.status,revision: sync.spreadsheet_revision,errorCode: safeCode(sync.error_code),
        warningCount: sync.warning_count,startedAt: sync.started_at.toISOString(),finishedAt: iso(sync.finished_at),
      } : null,
    };
  }
}
