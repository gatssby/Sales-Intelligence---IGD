import type { Sql, TransactionSql } from "postgres";

export type BudgetReservationResult =
  | { accepted: true; reservationId: string }
  | { accepted: false; reservationId: null; reason: "budget_ceiling" | "budget_paused" };

export class PostgresBudgetLedger {
  constructor(private readonly sql: Sql) {}

  async configureAccount(input: { accountId: string; limitUsd: number; safetyReserveUsd: number; externalSpendBaselineUsd: number }): Promise<void> {
    if (!input.accountId.trim() || ![input.limitUsd,input.safetyReserveUsd,input.externalSpendBaselineUsd].every(Number.isFinite)
      || input.limitUsd <= 0 || input.safetyReserveUsd < 0 || input.safetyReserveUsd >= input.limitUsd || input.externalSpendBaselineUsd < 0) {
      throw new Error("invalid_budget_account");
    }
    await this.sql`
      insert into ai_budget_accounts (id, limit_usd, safety_reserve_usd, external_spend_baseline_usd)
      values (${input.accountId}, ${input.limitUsd}, ${input.safetyReserveUsd}, ${input.externalSpendBaselineUsd})
      on conflict (id) do update set
        limit_usd=excluded.limit_usd, safety_reserve_usd=excluded.safety_reserve_usd,
        external_spend_baseline_usd=greatest(ai_budget_accounts.external_spend_baseline_usd, excluded.external_spend_baseline_usd),
        baseline_captured_at=case when excluded.external_spend_baseline_usd > ai_budget_accounts.external_spend_baseline_usd then now() else ai_budget_accounts.baseline_captured_at end,
        updated_at=now()
    `;
  }

  async reserve(input: {
    accountId: string; ownerType: "official" | "benchmark"; ownerId: string; requestKey: string;
    role: string; model: string; estimatedCostUsd: number;
  }): Promise<BudgetReservationResult> {
    if (!Number.isFinite(input.estimatedCostUsd) || input.estimatedCostUsd < 0) throw new Error("invalid_budget_reservation");
    return this.sql.begin(async (tx) => {
      const accounts = await tx<{ limit_usd: string | number; safety_reserve_usd: string | number; external_spend_baseline_usd: string | number; paused: boolean }[]>`
        select limit_usd, safety_reserve_usd, external_spend_baseline_usd, paused
        from ai_budget_accounts where id=${input.accountId} for update
      `;
      const account = accounts[0];
      if (!account) throw new Error("budget_account_not_found");
      if (account.paused) return { accepted: false, reservationId: null, reason: "budget_paused" } as const;
      const totals = await tx<{ settled: string | number; active: string | number }[]>`
        select
          coalesce(sum(actual_usd) filter (where status='settled'), 0) settled,
          coalesce(sum(reserved_usd) filter (where status in ('reserved','request_started','outcome_unknown')), 0) active
        from ai_cost_reservations where budget_account_id=${input.accountId}
      `;
      const ceiling = Number(account.limit_usd) - Number(account.safety_reserve_usd);
      const projected = Number(account.external_spend_baseline_usd) + Number(totals[0].settled) + Number(totals[0].active) + input.estimatedCostUsd;
      if (projected > ceiling + 1e-9) {
        await tx`update ai_budget_accounts set paused=true, pause_reason='budget_ceiling', updated_at=now() where id=${input.accountId}`;
        return { accepted: false, reservationId: null, reason: "budget_ceiling" } as const;
      }
      const rows = await tx<{ id: string }[]>`
        insert into ai_cost_reservations (
          budget_account_id, owner_type, owner_id, request_key, role, model, reserved_usd, status
        ) values (
          ${input.accountId}, ${input.ownerType}, ${input.ownerId}, ${input.requestKey},
          ${input.role}, ${input.model}, ${input.estimatedCostUsd}, 'reserved'
        )
        on conflict (owner_type, owner_id, request_key) do nothing
        returning id
      `;
      if (!rows[0]) throw new Error("budget_reservation_already_exists");
      return { accepted: true, reservationId: rows[0].id } as const;
    });
  }

  async reconcileLiveSpend(accountId: string, liveSpendUsd: number): Promise<void> {
    if (!Number.isFinite(liveSpendUsd) || liveSpendUsd < 0) throw new Error("invalid_live_spend");
    await this.sql.begin(async (tx) => {
      const accounts = await tx<{ external_spend_baseline_usd: string | number }[]>`
        select external_spend_baseline_usd from ai_budget_accounts where id=${accountId} for update
      `;
      if (!accounts[0]) throw new Error("budget_account_not_found");
      const totals = await tx<{ settled: string | number }[]>`
        select coalesce(sum(actual_usd) filter (where status='settled'),0) settled
        from ai_cost_reservations where budget_account_id=${accountId}
      `;
      const inferredBaseline = Math.max(0, liveSpendUsd - Number(totals[0].settled));
      await tx`
        update ai_budget_accounts set
          external_spend_baseline_usd=greatest(external_spend_baseline_usd,${inferredBaseline}),
          baseline_captured_at=now(), updated_at=now()
        where id=${accountId}
      `;
    });
  }

  async pauseAccount(accountId: string, reason: string): Promise<void> {
    const safeReason = reason.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "budget_paused";
    const rows = await this.sql`
      update ai_budget_accounts set paused=true, pause_reason=${safeReason}, updated_at=now()
      where id=${accountId} returning id
    `;
    if (!rows[0]) throw new Error("budget_account_not_found");
  }

  async markRequestStarted(reservationId: string): Promise<void> {
    const rows = await this.sql`
      update ai_cost_reservations set status='request_started', requested_at=now(), updated_at=now()
      where id=${reservationId} and status='reserved' returning id
    `;
    if (!rows[0]) throw new Error("budget_reservation_not_startable");
  }

  async releaseReserved(reservationId: string): Promise<void> {
    const rows = await this.sql`
      update ai_cost_reservations set status='released', updated_at=now()
      where id=${reservationId} and status='reserved' returning id
    `;
    if (!rows[0]) throw new Error("budget_reservation_not_releasable");
  }

  async settle(reservationId: string, receipt: { actualCostUsd: number; costSource: "gateway_actual" | "estimated" | "unavailable" }): Promise<void> {
    if (!Number.isFinite(receipt.actualCostUsd) || receipt.actualCostUsd < 0) throw new Error("invalid_actual_cost");
    await this.sql.begin(async (tx) => {
      const owners = await tx<{ budget_account_id: string }[]>`
        select budget_account_id from ai_cost_reservations where id=${reservationId}
      `;
      if (!owners[0]) throw new Error("budget_reservation_not_found");
      await tx`select id from ai_budget_accounts where id=${owners[0].budget_account_id} for update`;
      const reservations = await tx<{ budget_account_id: string }[]>`
        select budget_account_id from ai_cost_reservations where id=${reservationId} for update
      `;
      const rows = await tx`
        update ai_cost_reservations set status='settled', actual_usd=${receipt.actualCostUsd},
          cost_source=${receipt.costSource}, settled_at=now(), updated_at=now()
        where id=${reservationId} and status='request_started' returning id
      `;
      if (!rows[0]) throw new Error("budget_reservation_not_settleable");
      const snapshot = await this.snapshotWith(tx, owners[0].budget_account_id);
      if (snapshot.projectedSpendUsd > snapshot.spendCeilingUsd + 1e-9) {
        await tx`update ai_budget_accounts set paused=true, pause_reason='actual_cost_exceeded_ceiling', updated_at=now() where id=${owners[0].budget_account_id}`;
      }
    });
  }

  async markOutcomeUnknown(reservationId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      const owners = await tx<{ budget_account_id: string }[]>`select budget_account_id from ai_cost_reservations where id=${reservationId}`;
      if (!owners[0]) throw new Error("budget_reservation_not_found");
      await tx`select id from ai_budget_accounts where id=${owners[0].budget_account_id} for update`;
      const rows = await tx`
        update ai_cost_reservations set status='outcome_unknown', cost_source='unavailable', updated_at=now()
        where id=${reservationId} and status='request_started' returning id
      `;
      if (!rows[0]) throw new Error("budget_reservation_not_reconcilable");
    });
  }

  async recoverStaleReservations(accountId: string, staleBefore: Date): Promise<{ released: number; outcomeUnknown: number }> {
    return this.sql.begin(async (tx) => {
      const released = await tx`
        update ai_cost_reservations set status='released', updated_at=now()
        where budget_account_id=${accountId} and status='reserved' and created_at < ${staleBefore}
        returning id
      `;
      const unknown = await tx`
        update ai_cost_reservations set status='outcome_unknown', updated_at=now()
        where budget_account_id=${accountId} and status='request_started' and requested_at < ${staleBefore}
        returning id
      `;
      return { released: released.length, outcomeUnknown: unknown.length };
    });
  }

  async snapshot(accountId: string) {
    return this.snapshotWith(this.sql, accountId);
  }

  private async snapshotWith(executor: Sql | TransactionSql, accountId: string) {
    const rows = await executor<{
      limit_usd: string | number; safety_reserve_usd: string | number; external_spend_baseline_usd: string | number;
      paused: boolean; pause_reason: string | null; settled: string | number; active: string | number;
    }[]>`
      select a.limit_usd, a.safety_reserve_usd, a.external_spend_baseline_usd, a.paused, a.pause_reason,
        coalesce(sum(r.actual_usd) filter (where r.status='settled'), 0) settled,
        coalesce(sum(r.reserved_usd) filter (where r.status in ('reserved','request_started','outcome_unknown')), 0) active
      from ai_budget_accounts a left join ai_cost_reservations r on r.budget_account_id=a.id
      where a.id=${accountId}
      group by a.id
    `;
    if (!rows[0]) throw new Error("budget_account_not_found");
    const settledIncrementalUsd = Number(rows[0].settled);
    const activeReservationsUsd = Number(rows[0].active);
    const externalSpendBaselineUsd = Number(rows[0].external_spend_baseline_usd);
    return {
      limitUsd: Number(rows[0].limit_usd), safetyReserveUsd: Number(rows[0].safety_reserve_usd),
      spendCeilingUsd: Number(rows[0].limit_usd) - Number(rows[0].safety_reserve_usd),
      externalSpendBaselineUsd, settledIncrementalUsd, activeReservationsUsd,
      projectedSpendUsd: externalSpendBaselineUsd + settledIncrementalUsd + activeReservationsUsd,
      paused: rows[0].paused, pauseReason: rows[0].pause_reason,
    };
  }
}
