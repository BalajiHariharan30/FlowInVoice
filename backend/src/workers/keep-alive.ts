import http from "http";
import https from "https";

export function startKeepAlivePing(): void {
  const targetUrl = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/health`
    : process.env.BACKEND_URL || "http://localhost:3000/health";

  console.log(`[KeepAlive] Initializing self-ping service targeting: ${targetUrl}`);

  // Ping every 4.5 minutes (270,000 ms) to beat Render's 15-minute sleep timer
  const PING_INTERVAL_MS = 270000;

  setInterval(() => {
    try {
      const client = targetUrl.startsWith("https") ? https : http;

      const req = client.get(targetUrl, (res) => {
        console.log(`[KeepAlive Ping] Heartbeat status: ${res.statusCode} at ${new Date().toISOString()}`);
      });

      req.on("error", (err) => {
        console.warn(`[KeepAlive Ping Warning] Heartbeat failed: ${err.message}`);
      });

      req.setTimeout(5000, () => {
        req.destroy();
      });
    } catch (err: any) {
      console.error(`[KeepAlive Error]:`, err.message);
    }
  }, PING_INTERVAL_MS);
}
