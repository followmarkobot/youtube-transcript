import { NextRequest, NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function fetchVideoMeta(videoId: string) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!res.ok) return { title: "YouTube Video", thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
    const data = await res.json();
    return {
      title: data.title || "YouTube Video",
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  } catch {
    return { title: "YouTube Video", thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: "URL is required" }, { status: 400 });

    const videoId = extractVideoId(url.trim());
    if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

    const [meta, rawTranscript] = await Promise.all([
      fetchVideoMeta(videoId),
      YoutubeTranscript.fetchTranscript(videoId),
    ]);

    const transcript = rawTranscript.map((item: { offset: number; text: string }) => ({
      time: item.offset / 1000,
      text: item.text,
    }));

    return NextResponse.json({
      title: meta.title,
      thumbnail: meta.thumbnail,
      videoId,
      transcript,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch transcript";
    const noTranscript = message.toLowerCase().includes("transcript") || message.toLowerCase().includes("disabled");
    return NextResponse.json(
      { error: noTranscript ? "No transcript available for this video. It may be disabled or the video might not exist." : message },
      { status: 422 }
    );
  }
}
