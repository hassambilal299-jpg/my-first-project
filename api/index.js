// Vercel serverless entry. Every request is rewritten here (see vercel.json).
import { createApp } from "../src/server.js";

let app;

export default async function handler(req, res) {
  app ??= createApp(process.env);
  return app.handle(req, res);
}
