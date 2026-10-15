// Queue of actions that need a human "yes" before they run. Anything that sends
// a message or publishes content goes through here. Storage is whatever store
// is handed in, so the rules below behave identically locally and in Supabase.

// Rows come back in database shape; the HTTP API speaks camelCase.
function toItem(row) {
  if (!row) return row;
  return {
    id: row.id,
    businessId: row.business_id ?? null,
    action: row.action,
    summary: row.summary,
    payload: row.payload,
    status: row.status,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
  };
}

export class ApprovalQueue {
  constructor(store) {
    this.store = store;
  }

  async propose({ action, summary, payload, businessId = null }) {
    return toItem(await this.store.call("approvals.insert", { action, summary, payload, business_id: businessId }));
  }

  async list(status, businessId) {
    const rows = await this.store.call("approvals.list", { status, business_id: businessId });
    return rows.map(toItem);
  }

  async get(id) {
    return toItem(await this.store.call("approvals.get", { id }));
  }

  // Resolve a pending item. `execute` is the real side effect; it runs only on
  // approve, and a failure is recorded as failed rather than approved.
  async decide(id, decision, execute) {
    const item = await this.get(id);
    if (!item) throw new Error(`No approval item ${id}`);
    if (item.status !== "pending") throw new Error(`Item ${id} is already ${item.status}`);

    const decided_at = new Date().toISOString();
    if (decision === "reject") {
      return toItem(await this.store.call("approvals.update", { id, patch: { status: "rejected", decided_at } }));
    }

    try {
      const result = await execute(item);
      return toItem(
        await this.store.call("approvals.update", { id, patch: { status: "approved", result, decided_at } }),
      );
    } catch (err) {
      return toItem(
        await this.store.call("approvals.update", { id, patch: { status: "failed", error: err.message, decided_at } }),
      );
    }
  }
}
