// youtube_handler.js
import { getYouTubeTranscript, summarizeTranscript } from './yt_helpers.js';

/**
 * handleYouTubeLink:
 * - Ontvangt 'message' (WhatsApp), pakt body als URL
 * - Haalt transcript via Python
 * - Maakt samenvatting met OpenAI
 * - Stuurt terug als WhatsApp-bericht
 */
export async function handleYouTubeLink(message) {
    console.log("🎥 YouTube-link gedetecteerd, transcript + samenvatting...");

    const videoUrl = message.body.trim();
    const transcript = await getYouTubeTranscript(videoUrl);
    if (!transcript || transcript.startsWith("Fout")) {
        message.reply("⚠️ Kon geen transcript vinden voor deze video.");
        return;
    }

    const summary = await summarizeTranscript(transcript);
    message.reply(`📄 Samenvatting van de video:\n\n${summary}`);
    console.log(`✅ Samenvatting verstuurd naar ${message.from}`);
}
