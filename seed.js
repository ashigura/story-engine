// 📍 In Datei: seed.js (GitHub Web-Editor)
const { pool } = require("./db");

async function seed() {
  // simple check to avoid duplicates
  const ncount = await pool.query("select count(*)::int as c from node");
  if (ncount.rows[0].c > 0) {
    console.log("Nodes already exist, skipping seed.");
    process.exit(0);
  }

  const n1 = await pool.query(
    `insert into node (title, content_json) values ('Start', '{"text":"Du stehst vor dem Tor."}') returning id`
  );
  const n2 = await pool.query(
    `insert into node (title, content_json) values ('Links', '{"text":"Du gehst nach links."}') returning id`
  );
  const n3 = await pool.query(
    `insert into node (title, content_json) values ('Rechts', '{"text":"Du gehst nach rechts."}') returning id`
  );

  await pool.query(
    `insert into edge (from_node_id, to_node_id, label) values ($1,$2,'links')`,
    [n1.rows[0].id, n2.rows[0].id]
  );
  await pool.query(
    `insert into edge (from_node_id, to_node_id, label) values ($1,$2,'rechts')`,
    [n1.rows[0].id, n3.rows[0].id]
  );

  console.log("Seed done. startNodeId =", n1.rows[0].id);
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
