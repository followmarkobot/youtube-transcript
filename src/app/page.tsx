"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface TranscriptItem {
  time: number;
  text: string;
}

interface TranscriptData {
  title: string;
  thumbnail: string;
  videoId: string;
  transcript: TranscriptItem[];
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function isYouTubeUrl(text: string): boolean {
  return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)/.test(text.trim());
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [data, setData] = useState<TranscriptData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedLine, setCopiedLine] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchTranscript = useCallback(async (targetUrl: string) => {
    if (!targetUrl.trim()) return;
    if (!isYouTubeUrl(targetUrl)) {
      setError("Please enter a valid YouTube URL");
      return;
    }
    setError("");
    setLoading(true);
    setData(null);
    try {
      const res = await fetch("/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Something went wrong");
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  // Cmd+V auto-paste and fetch
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "v" && document.activeElement !== inputRef.current) {
        navigator.clipboard.readText().then((text) => {
          if (isYouTubeUrl(text)) {
            setUrl(text);
            fetchTranscript(text);
          }
        }).catch(() => {});
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fetchTranscript]);

  const copyAll = () => {
    if (!data) return;
    const text = data.transcript.map((t) => `[${formatTime(t.time)}] ${t.text}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyLine = (idx: number, item: TranscriptItem) => {
    navigator.clipboard.writeText(`[${formatTime(item.time)}] ${item.text}`);
    setCopiedLine(idx);
    setTimeout(() => setCopiedLine(null), 1500);
  };

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-12 md:py-20">
      {/* Header */}
      <div className="text-center mb-10 animate-fade-in">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
          YouTube Transcript
        </h1>
        <p className="text-[var(--text-muted)] text-base md:text-lg">
          Paste a URL. Get the transcript. That&apos;s it.
        </p>
      </div>

      {/* Input */}
      <div className="w-full max-w-2xl mb-8 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <form
          onSubmit={(e) => { e.preventDefault(); fetchTranscript(url); }}
          className="flex gap-3"
        >
          <input
            ref={inputRef}
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(""); }}
            placeholder="https://youtube.com/watch?v=..."
            className="flex-1 px-4 py-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-all text-base font-mono"
            autoFocus
            onFocus={() => {
              navigator.clipboard.readText().then((text) => {
                if (isYouTubeUrl(text) && !url) {
                  setUrl(text);
                }
              }).catch(() => {});
            }}
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="px-6 py-3 rounded-xl bg-[var(--accent)] text-[var(--bg)] font-semibold hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-base whitespace-nowrap"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                Extracting
              </span>
            ) : "Extract"}
          </button>
        </form>

        {error && (
          <p className="mt-3 text-sm text-red-400 animate-fade-in">{error}</p>
        )}

        {!data && !loading && !error && (
          <p className="mt-4 text-xs text-[var(--text-muted)] text-center">
            Press <kbd className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-xs font-mono">⌘V</kbd> anywhere to auto-paste &amp; extract
          </p>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="w-full max-w-2xl animate-fade-in">
          <div className="flex gap-4 mb-6">
            <div className="skeleton w-40 h-24 rounded-lg shrink-0" />
            <div className="flex-1 space-y-3 py-1">
              <div className="skeleton h-5 w-3/4" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          </div>
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="skeleton h-4 w-12 shrink-0 mt-0.5" />
                <div className="skeleton h-4 flex-1" style={{ width: `${60 + Math.random() * 40}%` }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {data && (
        <div className="w-full max-w-2xl animate-fade-in">
          {/* Video info */}
          <div className="flex gap-4 mb-6 items-start">
            <img
              src={data.thumbnail}
              alt={data.title}
              className="w-40 h-auto rounded-lg shrink-0 shadow-lg"
            />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-snug mb-1 line-clamp-2">{data.title}</h2>
              <a
                href={`https://youtube.com/watch?v=${data.videoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
              >
                Watch on YouTube ↗
              </a>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-[var(--text-muted)]">
              {data.transcript.length} segments
            </span>
            <button
              onClick={copyAll}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-hover)] transition-all text-sm font-medium"
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  Copy transcript
                </>
              )}
            </button>
          </div>

          {/* Transcript */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-[var(--border)]">
              {data.transcript.map((item, idx) => (
                <div
                  key={idx}
                  className="transcript-line flex gap-3 px-4 py-3 cursor-pointer transition-colors group"
                  onClick={() => copyLine(idx, item)}
                  title="Click to copy"
                >
                  <span className="text-xs font-mono text-[var(--accent)] pt-0.5 w-12 shrink-0 tabular-nums">
                    {formatTime(item.time)}
                  </span>
                  <span className="text-sm leading-relaxed flex-1">
                    {item.text}
                  </span>
                  <span className={`text-xs text-green-400 pt-0.5 transition-opacity ${copiedLine === idx ? "opacity-100" : "opacity-0 group-hover:opacity-50"}`}>
                    {copiedLine === idx ? "✓" : "copy"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-auto pt-16 pb-6 text-center text-xs text-[var(--text-muted)]">
        Built with Next.js • No data stored
      </footer>
    </main>
  );
}
