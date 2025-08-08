const express = require("express");
const { pingDb } = require("./db");
const app = express();
const port = process.env.PORT || 8080;

app.get("/health", (_req, res) => res.json({ ok: true }));
app.listen(port, () => console.log("Server on :" + port));
