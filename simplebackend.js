const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// 📌 Statische Dateien ausliefern (Frontend, Icons, Manifest, Service Worker)
app.use("/", express.static(__dirname));
app.use("/icons", express.static(path.join(__dirname, "icons")));

// 📌 FRONTEND ausliefern (wichtig für Handy!)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend.html"));
});

// 📌 Kuratierte Interaktionen laden
const interactions = JSON.parse(
  fs.readFileSync(path.join(__dirname, "interactions.json"), "utf8")
);

// 🔍 Aliase auflösen
function resolveDrugKey(inputDrug) {
  const input = inputDrug.toLowerCase();
  for (const key of Object.keys(interactions)) {
    const aliases = interactions[key]._aliases || [];
    if (aliases.map(a => a.toLowerCase()).includes(input)) {
      return key;
    }
  }
  return null;
}

// 🔍 FDA-Fallback: relevanten Ausschnitt extrahieren
function extractRelevantInteraction(fullText, food) {
  if (!fullText || typeof fullText !== "string") {
    return "Keine Interaktionsdaten gefunden.";
  }

  const lower = fullText.toLowerCase();
  const foodLower = food.toLowerCase();

  const index = lower.indexOf(foodLower);
  if (index === -1) {
    return "Keine spezifische Interaktion für dieses Lebensmittel gefunden.";
  }

  const start = Math.max(0, index - 150);
  const end = Math.min(fullText.length, index + 300);

  return fullText.substring(start, end) + "...";
}

// 🔄 Haupt-Endpunkt
app.post("/check", async (req, res) => {
  const { food, drug } = req.body;

  if (!food || !drug) {
    return res.json({
      source: "fehler",
      message: "Bitte sowohl Lebensmittel als auch Medikament angeben."
    });
  }

  const drugKey = resolveDrugKey(drug);
  const foodKey = food.toLowerCase();

  console.log("Anfrage:", foodKey, drugKey);

  // 1) Kuratierte Datenbank prüfen
  if (drugKey && interactions[drugKey] && interactions[drugKey][foodKey]) {
    const info = interactions[drugKey][foodKey];
    return res.json({
      source: "kuratiert",
      drug: drug,
      food: food,
      severity: info.severity,
      effect: info.effect,
      mechanism: info.mechanism,
      recommendation: info.recommendation
    });
  }

  // 2) FDA-Fallback
  const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(drug)}&limit=20`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return res.json({
        source: "fda",
        drug: drug,
        food: food,
        severity: "unbekannt",
        effect: "Für dieses Medikament wurden keine Interaktionsdaten gefunden.",
        mechanism: "",
        recommendation: "Bei Unsicherheit bitte ärztlichen oder pharmazeutischen Rat einholen."
      });
    }

    let combinedText = "";

    for (const entry of data.results) {
      for (const key of Object.keys(entry)) {
        const value = entry[key];
        if (typeof value === "string") combinedText += " " + value;
        if (Array.isArray(value)) combinedText += " " + value.join(" ");
      }
    }

    const snippet = extractRelevantInteraction(combinedText, food);

    return res.json({
      source: "fda",
      drug: drug,
      food: food,
      severity: "unbekannt",
      effect: snippet,
      mechanism: "",
      recommendation: "Diese Information stammt aus dem Beipackzettel; im Zweifel medizinischen Rat einholen."
    });
  } catch (err) {
    console.error("FDA-Fehler:", err);
    return res.json({
      source: "fehler",
      drug: drug,
      food: food,
      severity: "unbekannt",
      effect: "Beim Abrufen der Daten ist ein Fehler aufgetreten.",
      mechanism: "",
      recommendation: "Später erneut versuchen oder medizinischen Rat einholen."
    });
  }
});

// 🔄 Autocomplete: Medikamente
app.get("/medications", (req, res) => {
  const meds = Object.keys(interactions);
  res.json(meds);
});

// 🔄 Autocomplete: Lebensmittel abhängig vom Medikament
app.get("/foods/:drug", (req, res) => {
  const drugKey = resolveDrugKey(req.params.drug);

  if (!drugKey) {
    return res.json([]);
  }

  const foods = Object.keys(interactions[drugKey]).filter(k => k !== "_aliases");
  res.json(foods);
});

// 🚀 Server starten
app.listen(3000, () => console.log("FOODdrugs Backend läuft auf Port 3000"));
