// The sweep. For each business, read every connector that has credentials and
// record what is found as events, so a brief can later answer "what happened".
//
// Mock connectors record nothing. Writing invented events would make a brief
// look populated when nothing is actually connected, which is worse than an
// empty brief that says so.

const SWEEPS = [
  {
    source: "gmail",
    async run(connectors) {
      const res = await connectors.listUnreadEmails({ limit: 10 });
      if (res.mock) return { mock: true, note: res.note };
      return {
        events: (res.messages ?? []).map((m) => ({
          kind: "email.unread",
          summary: `Email from ${m.from}: ${m.subject}`,
          detail: { external_id: m.id, from: m.from, subject: m.subject },
        })),
      };
    },
  },
  {
    source: "shopify",
    async run(connectors) {
      const res = await connectors.recentOrders({ limit: 10 });
      if (res.mock) return { mock: true, note: res.note };
      return {
        events: (res.orders ?? []).map((o) => ({
          kind: "order.created",
          summary: `Order ${o.name ?? o.id} for ${o.total_price ?? "?"} ${o.currency ?? ""}`.trim(),
          detail: { external_id: String(o.id), total: o.total_price, email: o.email },
        })),
      };
    },
  },
];

export async function syncBusiness({ directory, business, connectorsFor }) {
  let credentials = {};
  try {
    credentials = await directory.credentials(business.id);
  } catch (err) {
    // No key configured, or an unreadable blob. Fall through to env defaults
    // rather than failing the whole sweep.
    credentials = {};
  }
  const connectors = connectorsFor(credentials);

  const report = { business: business.name, businessId: business.id, recorded: 0, duplicates: 0, notConnected: [], errors: [] };

  for (const sweep of SWEEPS) {
    try {
      const outcome = await sweep.run(connectors);
      if (outcome.mock) {
        report.notConnected.push(sweep.source);
        continue;
      }
      for (const event of outcome.events) {
        const saved = await directory.record({
          businessId: business.id,
          source: sweep.source,
          kind: event.kind,
          summary: event.summary,
          detail: event.detail,
        });
        if (saved && saved.duplicate) report.duplicates++;
        else report.recorded++;
      }
    } catch (err) {
      report.errors.push(`${sweep.source}: ${err.message}`);
    }
  }

  return report;
}

export async function syncAll({ directory, connectorsFor }) {
  const businesses = await directory.list();
  const reports = [];
  for (const business of businesses) {
    reports.push(await syncBusiness({ directory, business, connectorsFor }));
  }
  return { ranAt: new Date().toISOString(), businesses: reports.length, reports };
}
