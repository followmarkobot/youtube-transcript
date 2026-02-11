import { NextRequest, NextResponse } from "next/server";

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
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (!res.ok)
      return {
        title: "YouTube Video",
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      };
    const data = await res.json();
    return {
      title: data.title || "YouTube Video",
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  } catch {
    return {
      title: "YouTube Video",
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  }
}

interface InnertubeTranscriptSegment {
  utf8: string;
  tOffsetMs: string;
  dDurationMs: string;
}

async function fetchTranscriptInnertube(videoId: string) {
  // Step 1: Get the page to extract API key and continuation token
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const html = await pageRes.text();

  // Extract API key
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  const apiKey = apiKeyMatch?.[1] || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

  // Try to get captions from initial player response
  const playerMatch = html.match(
    new RegExp("ytInitialPlayerResponse\\s*=\\s*(\\{.+?\\})\\s*;\\s*(?:var\\s|<\\/script>)", "s")
  );
  if (playerMatch) {
    try {
      const player = JSON.parse(playerMatch[1]);
      const captionTracks =
        player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (captionTracks && captionTracks.length > 0) {
        // Prefer English, fall back to first track
        const track =
          captionTracks.find(
            (t: { languageCode: string }) => t.languageCode === "en"
          ) || captionTracks[0];
        const trackUrl = track.baseUrl + "&fmt=json3";
        const trackRes = await fetch(trackUrl);
        const trackData = await trackRes.json();
        if (trackData.events) {
          return trackData.events
            .filter((e: { segs?: unknown[] }) => e.segs)
            .map((e: { tStartMs: number; segs: { utf8: string }[] }) => ({
              time: e.tStartMs / 1000,
              text: e.segs.map((s: { utf8: string }) => s.utf8).join(""),
            }))
            .filter((e: { text: string }) => e.text.trim());
        }
      }
    } catch {
      // Fall through to Innertube API
    }
  }

  // Step 2: Use Innertube API to get transcript
  // First get video info to find transcript panel
  const playerApiRes = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20240101.00.00",
            hl: "en",
            gl: "US",
          },
        },
        videoId,
      }),
    }
  );
  const playerData = await playerApiRes.json();

  const captionTracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!captionTracks || captionTracks.length === 0) {
    throw new Error("NO_TRANSCRIPT");
  }

  const track =
    captionTracks.find(
      (t: { languageCode: string }) => t.languageCode === "en"
    ) || captionTracks[0];
  const trackUrl = track.baseUrl + "&fmt=json3";
  const trackRes = await fetch(trackUrl);
  const trackData = await trackRes.json();

  if (!trackData.events) {
    throw new Error("NO_TRANSCRIPT");
  }

  return trackData.events
    .filter((e: { segs?: InnertubeTranscriptSegment[] }) => e.segs)
    .map((e: { tStartMs: number; segs: InnertubeTranscriptSegment[] }) => ({
      time: e.tStartMs / 1000,
      text: e.segs.map((s) => s.utf8).join(""),
    }))
    .filter((e: { text: string }) => e.text.trim());
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url)
      return NextResponse.json({ error: "URL is required" }, { status: 400 });

    const videoId = extractVideoId(url.trim());
    if (!videoId)
      return NextResponse.json(
        { error: "Invalid YouTube URL" },
        { status: 400 }
      );

    const [meta, transcript] = await Promise.all([
      fetchVideoMeta(videoId),
      fetchTranscriptInnertube(videoId),
    ]);

    return NextResponse.json({
      title: meta.title,
      thumbnail: meta.thumbnail,
      videoId,
      transcript,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch transcript";
    if (message === "NO_TRANSCRIPT") {
      return NextResponse.json(
        {
          error:
            "No transcript available for this video. It may not have captions enabled.",
        },
        { status: 422 }
      );
    }
    return NextResponse.json(
      { error: `Failed to fetch transcript: ${message}` },
      { status: 500 }
    );
  }
}
