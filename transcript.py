import sys
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled
import re

def main():
    if len(sys.argv) < 2:
        print("Fout: geen video-URL meegegeven.")
        return

    video_url = sys.argv[1]
    video_id = extract_video_id(video_url)
    if not video_id:
        print("Fout: kon geen video_id extraheren.")
        return

    try:
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
        full_text = " ".join([entry['text'] for entry in transcript_list])
        print(full_text)
    except TranscriptsDisabled:
        print("Fout: Transcripties zijn uitgeschakeld voor deze video.")
    except Exception as e:
        print(f"Fout: {str(e)}")

def extract_video_id(url: str):
    pattern = r"(?:v=|youtu\.be/|embed/|watch\?v=)([a-zA-Z0-9_-]{11})"
    match = re.search(pattern, url)
    return match.group(1) if match else None

if __name__ == "__main__":
    main()
