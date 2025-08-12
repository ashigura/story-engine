// 📍 Datei: seed.js
const { pool } = require("./db");

async function seed() {
  console.log("[DB] Seeding gestartet...");

  try {
    // Vorher alles löschen
    await pool.query("DELETE FROM decision");
    await pool.query("DELETE FROM session");
    await pool.query("DELETE FROM edge");
    await pool.query("DELETE FROM node");

    // 1️⃣ Startnode
    const startNode = await pool.query(`
      INSERT INTO node (title, content_json)
      VALUES ($1, $2)
      RETURNING id
    `, ["Startpunkt", { text: "Du befindest dich am Anfang deiner Reise." }]);
    const startNodeId = startNode.rows[0].id;

    // 2️⃣ Zwei neue Nodes
    const leftNode = await pool.query(`
      INSERT INTO node (title, content_json)
      VALUES ($1, $2)
      RETURNING id
    `, ["Links gegangen", { text: "Du bist nach links gegangen." }]);
    const leftNodeId = leftNode.rows[0].id;

    const rightNode = await pool.query(`
      INSERT INTO node (title, content_json)
      VALUES ($1, $2)
      RETURNING id
    `, ["Rechts gegangen", { text: "Du bist nach rechts gegangen." }]);
    const rightNodeId = rightNode.rows[0].id;

    // 3️⃣ Edges
    await pool.query(`
      INSERT INTO edge (from_node_id, to_node_id, label)
      VALUES ($1, $2, $3)
    `, [startNodeId, leftNodeId, "links"]);

    await pool.query(`
      INSERT INTO edge (from_node_id, to_node_id, label)
      VALUES ($1, $2, $3)
    `, [startNodeId, rightNodeId, "rechts"]);

    console.log("[DB] Seeding erfolgreich ✅");
    console.log("Startnode:", startNodeId);
    console.log("Links-Node:", leftNodeId);
    console.log("Rechts-Node:", rightNodeId);

    return { startNodeId, leftNodeId, rightNodeId };
  } catch (err) {
    console.error("[DB] Fehler beim Seeding ❌", err);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  seed();
}

module.exports = seed;
