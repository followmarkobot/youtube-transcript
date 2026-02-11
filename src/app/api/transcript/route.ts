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

interface CaptionTrack {
  languageCode: string;
  baseUrl: string;
  name?: { simpleText?: string };
}

interface TranscriptEvent {
  tStartMs: number;
  segs?: { utf8: string }[];
}

// Strategy 1: iOS Innertube client (best success rate from servers)
async function fetchViaIOS(videoId: string): Promise<CaptionTrack[] | null> {
  const res = await fetch(
    "https://www.youtube.com/youtubei/v1/player?key=AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc&prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "IOS",
            clientVersion: "19.09.3",
            deviceModel: "iPhone14,3",
            hl: "en",
            gl: "US",
          },
        },
        videoId,
      }),
    }
  );
  const data = await res.json();
  if (data.playabilityStatus?.status !== "OK") return null;
  return (
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null
  );
}

// Strategy 2: WEB client via page scrape
async function fetchViaWebPage(videoId: string): Promise<CaptionTrack[] | null> {
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const html = await pageRes.text();

  const playerMatch = html.match(
    new RegExp(
      "ytInitialPlayerResponse\\s*=\\s*(\\{.+?\\})\\s*;\\s*(?:var\\s|<\\/script>)",
      "s"
    )
  );
  if (!playerMatch) return null;

  try {
    const player = JSON.parse(playerMatch[1]);
    return (
      player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null
    );
  } catch {
    return null;
  }
}

// Strategy 3: WEB Innertube API
async function fetchViaWebAPI(videoId: string): Promise<CaptionTrack[] | null> {
  const res = await fetch(
    "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false",
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
  const data = await res.json();
  if (data.playabilityStatus?.status !== "OK") return null;
  return (
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null
  );
}

async function downloadTranscript(tracks: CaptionTrack[]) {
  // Prefer English, fall back to first
  const track =
    tracks.find((t) => t.languageCode === "en") || tracks[0];
  const trackUrl = track.baseUrl + "&fmt=json3";
  const res = await fetch(trackUrl);
  const data = await res.json();

  if (!data.events) throw new Error("NO_TRANSCRIPT");

  return data.events
    .filter((e: TranscriptEvent) => e.segs)
    .map((e: TranscriptEvent) => ({
      time: e.tStartMs / 1000,
      text: e.segs!.map((s) => s.utf8).join(""),
    }))
    .filter((e: { text: string }) => e.text.trim());
}

async function fetchTranscript(videoId: string) {
  // Try strategies in order of reliability
  const strategies = [fetchViaIOS, fetchViaWebPage, fetchViaWebAPI];

  for (const strategy of strategies) {
    try {
      const tracks = await strategy(videoId);
      if (tracks && tracks.length > 0) {
        return await downloadTranscript(tracks);
      }
    } catch {
      continue;
    }
  }

  throw new Error("NO_TRANSCRIPT");
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
      fetchTranscript(videoId),
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
            "No transcript available for this video. It may not have captions enabled, or YouTube may be blocking server access.",
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
