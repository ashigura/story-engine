const express = require("express");
const { pingDb } = require("./db");
const app = express();
const port = process.env.PORT || 8080;

app.get("/health", (_req, res) => res.json({ ok: true }));
app.listen(port, () => console.log("Server on :" + port));
app.get("/db/ping", async (_req, res) => {
  try {
    const row = await pingDb();
    res.json({ db: "ok", row });
  } catch (e) {
    console.error(e);
    res.status(500).json({ db: "error", message: String(e) });
  }
});
