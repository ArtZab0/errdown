const express = require("express");
const app = express();
app.get("/boom", () => { throw new Error("boom"); });
app.post("/json", express.json({ limit: "1kb" }), (req, res) => res.send("ok"));
app.listen(80);
