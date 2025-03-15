// intent_handler.js
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// OpenAI-client initialiseren
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Logt de beslissing van ChatGPT-4o Mini in een bestand.
 * @param {string} message - Het ontvangen bericht.
 * @param {string} decision - 'ja' of 'nee'
 * @param {string} modelResponse - De ruwe tekst van GPT-4o-mini.
 */
function logDecision(message, decision, modelResponse) {
    const logFile = path.join(process.cwd(), 'bot_log.txt');
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] Bericht: "${message}" | AI Antwoord: "${modelResponse}" | Beslissing: ${decision}\n`;

    fs.appendFile(logFile, logEntry, (err) => {
        if (err) console.error("[ERROR] Fout bij schrijven naar logbestand:", err);
    });
}

/**
 * Beslist of Jeroen moet reageren op basis van ChatGPT-4o Mini.
 * @param {string} message - Het ontvangen WhatsApp-bericht.
 * @returns {Promise<{ shouldRespond: boolean }>}
 */
export async function shouldRespond(message) {
    // **Stap 1: Vraag ChatGPT-4o Mini om te bepalen of Jeroen moet reageren**
    const prompt = `
Je bent een AI die bepaalt of Jeroen moet reageren in een WhatsApp-groep. 
Je evalueert het bericht en de chatcontext op basis van het volgende puntensysteem:

1️⃣ **Directe betrokkenheid**:
- Wordt Jeroen genoemd in het bericht? → **+40 punten**
- Eindigt het bericht met een vraagteken? → **+30 punten**
- Is er een vraag die langer dan een uur onbeantwoord blijft? → **+20 punten**
- Is het een herhaald bericht zonder eerdere reactie? → **+15 punten**

2️⃣ **Sociale Dynamiek**:
- Zijn er in de afgelopen 5 minuten veel berichten verstuurd? → **+20 punten**
- Zijn er minimaal 3 mensen actief in de groep? → **+15 punten**
- Is het een lopende discussie (bijv. plannen maken)? → **+20 punten**
- Is het bericht initiërend (voorstel activiteit)? → **+10 punten**

3️⃣ **Inhoudelijke Relevantie**:
- Gaat het over een onderwerp waar Jeroen eerder over gesproken heeft? → **+15 punten**

4️⃣ **Tijd en context**:
- Is het bericht minder dan 10 minuten na het vorige bericht verstuurd? → **+10 punten**
- Avondbonus (18:00 - 00:00)? → **+10 punten**

📌 **Beslissingsregel**:
Als het bericht 50 of meer punten heeft, antwoord dan 'ja'. Anders 'nee'.
Je mag GEEN uitleg geven, alleen 'ja' of 'nee'.

**Bericht:** "${message}"
`.trim();

    try {
        // **Stap 2: Vraag ChatGPT-4o Mini om een beslissing**
        const response = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: prompt }],
            temperature: 0
        });

        // **Stap 3: Verwerk het antwoord**
        const rawReply = response.choices[0].message.content.trim().toLowerCase();
        console.log("[DEBUG] rawReply:", rawReply);

        // **Stap 4: Verwijder modificatie van message hier**
        const shouldRespondResult = rawReply === "ja";

        // **Stap 5: Log het besluit**
        logDecision(message, rawReply, rawReply);

        return { shouldRespond: shouldRespondResult }; // Retourneer alleen boolean
    } catch (error) {
        console.error("[ERROR] Fout bij intentieherkenning:", error);
        logDecision(message, "fout", "Error: " + error.message);
        return { shouldRespond: false }; // Retourneer alleen boolean
    }
}
