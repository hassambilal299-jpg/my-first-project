// File-backed queue of actions that need a human "yes" before they run.
// Anything that sends a message or publishes content goes through here.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export class ApprovalQueue {
  constructor(filePath) {
    this.filePath = filePath;
    this.items = existsSync(filePath)
      ? JSON.parse(readFileSync(filePath, "utf8"))
      : [];
  }

  save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.items, null, 2));
  }

  propose({ action, summary, payload }) {
    const item = {
      id: randomUUID(),
      action,
      summary,
      payload,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.items.push(item);
    this.save();
    return item;
  }

  list(status) {
    return status ? this.items.filter((i) => i.status === status) : [...this.items];
  }

  get(id) {
    return this.items.find((i) => i.id === id);
  }

  // Resolve a pending item. `execute` is the real side effect; it runs only on approve.
  async decide(id, decision, execute) {
    const item = this.get(id);
    if (!item) throw new Error(`No approval item ${id}`);
    if (item.status !== "pending") throw new Error(`Item ${id} is already ${item.status}`);

    if (decision === "reject") {
      item.status = "rejected";
      item.decidedAt = new Date().toISOString();
      this.save();
      return item;
    }

    try {
      item.result = await execute(item);
      item.status = "approved";
    } catch (err) {
      item.status = "failed";
      item.error = err.message;
    }
    item.decidedAt = new Date().toISOString();
    this.save();
    return item;
  }
}
