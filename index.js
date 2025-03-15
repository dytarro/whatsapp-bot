/************************************************************
 * index.js - WhatsApp Bot (Spotify + Tor + Vision + YouTube)
 * ---------------------------------------------------------
 * 1) Gebruikt één globale thread voor alle berichten
 * 2) Alle binnenkomende berichten -> altijd toegevoegd aan de thread
 * 3) intent_handler.js (GPT-4o-mini) checkt of we reageren
 * 4) Zo ja -> Jeroen-genereert-antwoord, anders -> alleen "." in de thread
 ************************************************************/

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import wwebjs from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { exec } from 'child_process';
import net from 'net';
import fetch from 'node-fetch';
import { shouldRespond } from './intent_handler.js';
console.log('shouldRespond functie geïmporteerd:', shouldRespond);
import { handleYouTubeLink } from './youtube_handler.js';

const { Client, LocalAuth } = wwebjs;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const assistantId = process.env.ASSISTANT_ID || "asst_jNcK131A35qLwUfIweW6mx9L";

// Spotify credentials
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Token-cache
let spotifyAccessToken = null;
let spotifyTokenExpiresAt = 0;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: [
            '--proxy-server=socks5://127.0.0.1:9150',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ],
        ignoreHTTPSErrors: true,
        headless: true,
        timeout: 60000
    }
});

client.on('qr', (qr) => {
    console.log("Scan deze QR-code:");
    qrcode.generate(qr, { small: true });
});

let globalThreadId = null;

client.on('ready', async () => {
    console.log('✅ WhatsApp-bot is actief via Tor + OpenAI!');

    globalThreadId = loadThreadId();
    if (!globalThreadId) {
        console.log("🔄 Geen opgeslagen thread-ID gevonden. Nieuwe thread aanmaken...");
        const thread = await openai.beta.threads.create();
        globalThreadId = thread.id;
        saveThreadId(globalThreadId);
    } else {
        console.log(`🧠 Opgeslagen thread-ID geladen: ${globalThreadId}`);
    }
});

function renewTorCircuit() {
    const socket = net.connect(9051, '127.0.0.1', () => {
        socket.write('AUTHENTICATE ""\r\nSIGNAL NEWNYM\r\nQUIT\r\n');
        socket.end();
        console.log("🔄 Nieuw Tor-circuit aangevraagd.");
    });
}

client.on('disconnected', async (reason) => {
    console.log(`⚠️ Bot is losgekoppeld! Reden: ${reason}`);
    renewTorCircuit();
    console.log("🔄 Probeer opnieuw te verbinden...");
    client.initialize();
});

/**
 * Globale message listener
 * 1) Voeg bericht toe aan de globale thread
 * 2) Check of we moeten reageren met GPT-4o-mini
 * 3) Zo nee -> voeg "." toe in de thread (assistant), geen WhatsApp-reactie
 * 4) Zo ja -> doe specialized logic (YouTube, Spotify...) of normal
 */
client.on('message', async (message) => {
    try {
        console.log(`📥 [IN] Ontvangen bericht van ${message.from}: "${message.body}"`);
        console.log('🔍 [DEBUG] Start intentiecontrole...');

        // Controleer intentie met OpenAI Mini
        const response = await shouldRespond(message.body);
        const shouldRespondResult = response.shouldRespond;
        console.log(`🤔 [INTENTIE] Moet reageren? ${shouldRespondResult ? '✅ JA' : '❌ NEE'}`);
        console.log('🔍 [DEBUG] Intentiecontrole voltooid.');

        console.log('🔍 [DEBUG] Voeg bericht toe aan de thread...');
        let threadMessageContent = message.body; // Standaard originele bericht
        if (!shouldRespondResult) {
            threadMessageContent = "🔻🔻🔻 " + message.body; // Markeer met 🔻🔻🔻 indien NEE
            console.log(`💤 [NO-REPLY] Bericht genegeerd en gemarkeerd in thread.`);
        } else {
            console.log(`✅ [WEL REAGEREN] Verwerk specialized logic indien nodig...`);
        }

        await openai.beta.threads.messages.create(globalThreadId, {
            role: "user",
            content: threadMessageContent
        });
        console.log('🔍 [DEBUG] Bericht toegevoegd aan de thread.');

        if (!shouldRespondResult) {
            return; // Stop hier als er niet gereageerd hoeft te worden via WhatsApp
        }

        if (isYouTubeLink(message.body)) {
            return handleYouTubeMessage(message);
        }

        if (shouldRespondResult) {
            const typingDelay = getRandomDelay(3000, 10000);
            console.log(`⌛ Wacht ${typingDelay / 1000} seconden voor verzenden...`);
            await delay(typingDelay);

            // Simuleer dat de bot "aan het typen" is
            await client.sendPresenceAvailable();

            // AI-reactie genereren
            console.log('🔍 [DEBUG] Genereer AI-reactie...');
            const aiAnswer = await getAssistantAnswer(globalThreadId);
            console.log(`🤖 [AI] OpenAI antwoord: "${aiAnswer}"`);

            // Extra vertraging voor realistische timing
            await delay(getRandomDelay(2000, 5000));

            // Stop "aan het typen" en verstuur bericht
            console.log('🔍 [DEBUG] Verstuur AI-reactie...');
            await message.reply(aiAnswer);
            console.log('🔍 [DEBUG] AI-reactie verstuurd.');
        }
    } catch (error) {
        console.error(`❌ [ERROR] Fout in message handler:`, error);
    }
});

/**
 * handleNormalMessage:
 * - Hier doen we een run op de Assistants API (de "grote" Jeroen)
 * - We reply direct naar WhatsApp met Jeroen's antwoord
 */
async function handleNormalMessage(message) {
    console.log(`🧵 [THREAD] handleNormalMessage -> ${globalThreadId}`);

    // 1) Start de AI om te reageren op basis van de globale thread
    let run = await openai.beta.threads.runs.create(globalThreadId, {
        assistant_id: assistantId
    });

    while (!isFinal(run.status)) {
        await delay(1000);
        run = await openai.beta.threads.runs.retrieve(globalThreadId, run.id);
    }

    if (run.status === "completed") {
        const aiAnswer = await getAssistantAnswer(globalThreadId);
        console.log(`🤖 [AI ANSWER] => "${aiAnswer}"`);
        message.reply(aiAnswer);

        // AI-antwoord zit nu al in de thread als 'assistant'-bericht
        // (Automatisch door de Assistants API)
    } else if (run.status === "incomplete") {
        message.reply("Sorry, mijn antwoord werd afgebroken.");
    } else {
        message.reply("De AI kon niet reageren. Probeer later nog eens!");
    }
}

// ================
//  YouTube
// ================
async function handleYouTubeMessage(message) {
    console.log("🎥 [YT] Transcript + Samenvatting...");

    const videoUrl = message.body.trim();
    const transcript = await getYouTubeTranscript(videoUrl);
    if (!transcript || transcript.startsWith("Fout")) {
        message.reply("⚠️ Kon geen transcript vinden voor deze video.");
        return;
    }

    const summary = await summarizeTranscript(transcript);

    // Voeg hier een extra user-bericht toe voor de samenvatting
    await openai.beta.threads.messages.create(globalThreadId, {
        role: "user",
        content: `Samenvatting van de video:\n${summary}\n\nReageer zoals Jeroen Elswijk.`
    });

    // Nu runnen we de Assistants API voor Jeroen's reactie
    let run = await openai.beta.threads.runs.create(globalThreadId, {
        assistant_id: assistantId
    });

    while (!isFinal(run.status)) {
        await delay(1000);
        run = await openai.beta.threads.runs.retrieve(globalThreadId, run.id);
    }

    if (run.status === "completed") {
        const aiAnswer = await getAssistantAnswer(globalThreadId);
        message.reply(aiAnswer);
    } else if (run.status === "incomplete") {
        message.reply("Sorry, mijn antwoord werd afgebroken.");
    } else {
        message.reply("De AI kon niet reageren, probeer later nog eens!");
    }
}

// ================
//  Afbeelding -> Vision
// ================
async function handleImageMessage(message) {
    console.log("🖼  Afbeelding gedetecteerd, verwerken...");

    const media = await message.downloadMedia();
    if (!media) {
        message.reply("⚠️ Kon de afbeelding niet downloaden.");
        return;
    }

    const buf = Buffer.from(media.data, 'base64');
    const tempFilename = `image_${Date.now()}.png`;
    fs.writeFileSync(tempFilename, buf);

    try {
        // Upload image to OpenAI
        const file = await openai.files.create({
            file: fs.createReadStream(path.join(process.cwd(), tempFilename)),
            purpose: "vision"
        });
        console.log("✅  file_id:", file.id);

        // Voeg user-bericht toe in de thread om context te geven
        await openai.beta.threads.messages.create(globalThreadId, {
            role: "user",
            content: [
                {
                    type: "text",
                    text: "Je bent Jeroen Elswijk, reageer droog en sarcastisch op de inhoud van deze afbeelding:"
                },
                {
                    type: "image_file",
                    image_file: {
                        file_id: file.id,
                        detail: "low"
                    }
                }
            ]
        });

        // AI run
        let run = await openai.beta.threads.runs.create(globalThreadId, {
            assistant_id: assistantId
        });

        while (!isFinal(run.status)) {
            await delay(1500);
            run = await openai.beta.threads.runs.retrieve(globalThreadId, run.id);
        }

        if (run.status === "completed") {
            const aiAnswer = await getAssistantAnswer(globalThreadId);
            message.reply(aiAnswer);
        } else if (run.status === "incomplete") {
            message.reply("Sorry, mijn reactie werd afgebroken.");
        } else {
            message.reply("De AI kon geen reactie geven, probeer later.");
        }

    } catch (err) {
        console.error("❌ [ERROR] Vision API:", err);
        message.reply("⚠️ Er trad een fout op bij het analyseren van de afbeelding.");
    } finally {
        fs.unlinkSync(tempFilename);
    }
}

// ================
//  Spotify
// ================
async function handleSpotifyMessage(message) {
    console.log("🎧 [SPOTIFY] link gedetecteerd, metadata ophalen...");

    const { type, spotifyId } = parseSpotifyLink(message.body);
    if (!spotifyId) {
        message.reply("⚠️ Kon geen geldige Spotify-link parsen.");
        return;
    }

    try {
        const token = await getSpotifyToken();
        if (!token) {
            message.reply("⚠️ Kon geen Spotify-token ophalen.");
            return;
        }

        const meta = await fetchSpotifyMetadata(type, spotifyId, token);
        if (!meta) {
            message.reply("⚠️ Kon geen Spotify-info vinden. Is dit privé?");
            return;
        }

        const prompt = makeSpotifyPrompt(meta, type);

        // Zet user-bericht in de thread voor context
        await openai.beta.threads.messages.create(globalThreadId, {
            role: "user",
            content: prompt
        });

        // AI run
        let run = await openai.beta.threads.runs.create(globalThreadId, {
            assistant_id: assistantId
        });

        while (!isFinal(run.status)) {
            await delay(1000);
            run = await openai.beta.threads.runs.retrieve(globalThreadId, run.id);
        }

        if (run.status === "completed") {
            const aiAnswer = await getAssistantAnswer(globalThreadId);
            message.reply(aiAnswer);
        } else if (run.status === "incomplete") {
            message.reply("Sorry, mijn reactie werd afgebroken.");
        } else {
            message.reply("De AI kon niet reageren, probeer later!");
        }
    } catch (err) {
        console.error("❌ Fout bij Spotify-verwerking:", err);
        message.reply("⚠️ Er trad een fout op bij het verwerken van de Spotify-link.");
    }
}

// -------------- Helpers --------------

function isSpotifyLink(text) {
    if (!text) return false;
    const pattern = /open\.spotify\.com\/(track|album|playlist|show|episode)\/([A-Za-z0-9]+)/i;
    return pattern.test(text);
}

function parseSpotifyLink(text) {
    const pattern = /open\.spotify\.com\/(track|album|playlist|show|episode)\/([A-Za-z0-9]+)/i;
    const match = text.match(pattern);
    if (!match) return { type: null, spotifyId: null };
    return { type: match[1], spotifyId: match[2] };
}

async function getSpotifyToken() {
    const now = Date.now();
    if (spotifyAccessToken && now < spotifyTokenExpiresAt) {
        return spotifyAccessToken;
    }

    const tokenUrl = "https://accounts.spotify.com/api/token";
    const creds = `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`;
    const authHeader = "Basic " + Buffer.from(creds).toString("base64");

    const resp = await fetch(tokenUrl, {
        method: "POST",
        headers: {
            "Authorization": authHeader,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
    });
    const data = await resp.json();

    if (!data.access_token) {
        console.error("⚠️ Kon geen Spotify access_token vinden:", data);
        return null;
    }

    spotifyAccessToken = data.access_token;
    const expiresIn = data.expires_in * 1000;
    spotifyTokenExpiresAt = Date.now() + expiresIn - 60000;
    console.log("✅ Spotify-token opgehaald, verloopt over (ms):", expiresIn);
    return spotifyAccessToken;
}

async function fetchSpotifyMetadata(type, id, token) {
    let url;
    switch (type) {
        case "track":
            url = `https://api.spotify.com/v1/tracks/${id}`;
            break;
        case "album":
            url = `https://api.spotify.com/v1/albums/${id}`;
            break;
        case "playlist":
            url = `https://api.spotify.com/v1/playlists/${id}`;
            break;
        case "show":
            url = `https://api.spotify.com/v1/shows/${id}`;
            break;
        case "episode":
            url = `https://api.spotify.com/v1/episodes/${id}`;
            break;
        default:
            return null;
    }

    const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) {
        console.error("Spotify API error:", resp.status, resp.statusText);
        return null;
    }
    return await resp.json();
}

function makeSpotifyPrompt(metadata, type) {
    switch (type) {
        case "track":
            return `Je bent Jeroen Elswijk. Reageer droog en sarcastisch op deze Spotify-track:
Titel: ${metadata.name}
Artiest: ${metadata.artists?.[0]?.name || "Onbekend"} 
Album: ${metadata.album?.name || "Onbekend"}`;

        case "album":
            return `Je bent Jeroen Elswijk. Reageer droog en sarcastisch op dit Spotify-album:
Albumtitel: ${metadata.name}
Artiest: ${metadata.artists?.[0]?.name || "Onbekend"}`;

        case "playlist":
            return `Je bent Jeroen Elswijk. Reageer sarcastisch op deze Spotify-playlist:
Naam: ${metadata.name}
Owner: ${metadata.owner?.display_name || "Onbekend"}
Aantal tracks: ${metadata.tracks?.total || 0}`;

        case "show":
            return `Je bent Jeroen Elswijk. Reageer droog en cynisch op deze Spotify-podcast:
Naam: ${metadata.name}
Publisher: ${metadata.publisher}`;

        case "episode":
            return `Je bent Jeroen Elswijk. Reageer sarcastisch op deze Spotify-podcast-aflevering:
Aflevering: ${metadata.name}
Podcast: ${metadata.show?.name || "Onbekend"}
Sprekers: ${metadata.show?.publisher || "Onbekend"}`;

        default:
            return `Je bent Jeroen Elswijk. Dit is een onherkenbaar Spotify-object. Reageer cynisch en kort.`;
    }
}

// ============== YouTube Helpers
async function getYouTubeTranscript(videoUrl) {
    return new Promise(resolve => {
        exec(`python transcript.py "${videoUrl}"`, (error, stdout, stderr) => {
            if (error) {
                resolve(`Fout: ${stderr || error.message}`);
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

async function summarizeTranscript(transcript) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "Je bent een AI die YouTube-transcripties samenvat." },
                { role: "user", content: `Vat deze transcriptie samen: ${transcript}` }
            ]
        });
        return response.choices[0].message.content;
    } catch (err) {
        return `Fout bij samenvatten: ${err.message}`;
    }
}

// ============== Generic
function isFinal(status) {
    return ["completed", "failed", "cancelled", "incomplete"].includes(status);
}

async function getAssistantAnswer(threadId) {
    const allMsgs = (await openai.beta.threads.messages.list(threadId)).data;
    const assistantMsgs = allMsgs.filter(m => m.role === "assistant");
    if (assistantMsgs.length === 0) {
        return "Geen AI-antwoord ontvangen...";
    }
    return parseAssistantContent(assistantMsgs[assistantMsgs.length - 1].content);
}

function parseAssistantContent(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content.map(parseSingleElement).join("\n\n");
    }
    if (content && typeof content === "object") {
        return parseSingleElement(content);
    }
    return String(content);
}

function parseSingleElement(el) {
    if (typeof el === "string") return el;
    if (!el || typeof el !== "object") return String(el);

    const { type } = el;
    switch (type) {
        case "text":
            if (typeof el.text === "string") return el.text;
            if (el.text?.value) return el.text.value;
            return "[Onbekend text-formaat]";
        case "image_url":
            if (el.image_url?.url) return `🔗 Afbeelding-URL: ${el.image_url.url}`;
            return `[Afbeelding-URL: ${JSON.stringify(el)}]`;
        case "image_file":
            if (el.image_file?.file_id) return `🖼 Afbeelding-bestand (ID: ${el.image_file.file_id}).`;
            return `[Afbeelding-bestand: ${JSON.stringify(el)}]`;
        case "function_call":
            return `[Tool call: ${el.name || "onbekend"} - args: ${JSON.stringify(el.arguments || {}, null, 2)}]`;
        default:
            return JSON.stringify(el, null, 2);
    }
}

function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Thread ID opslag in file
const THREAD_FILE = 'thread_id.json';

function loadThreadId() {
    if (fs.existsSync(THREAD_FILE)) {
        const data = fs.readFileSync(THREAD_FILE, 'utf8');
        const json = JSON.parse(data);
        return json.threadId || null;
    }
    return null;
}

function saveThreadId(threadId) {
    fs.writeFileSync(THREAD_FILE, JSON.stringify({ threadId }, null, 2));
}

function isYouTubeLink(text) {
    if (!text) return false;
    const pattern = /(youtube\.com\/watch\?v=|youtu\.be\/)/i;
    return pattern.test(text);
}

client.initialize();

client.on('ready', () => {
    console.log('✅ WhatsApp Web.js is verbonden!');
});