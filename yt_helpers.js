// yt_helpers.js
import { exec } from 'child_process';
import OpenAI from 'openai';
import 'dotenv/config';

export function getYouTubeTranscript(videoUrl) {
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

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export async function summarizeTranscript(transcript) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
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
