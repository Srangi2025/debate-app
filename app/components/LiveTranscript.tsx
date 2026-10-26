"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { authenticatedFetch } from "@/lib/guest-auth";
import { encodeWav } from "@/lib/audio-wav";
import { pendingContributions, persistContribution, removeContribution, type PendingContribution } from "@/lib/transcript-outbox";
import type { TranscriptSegment } from "@/lib/transcript";
import { LiveFeedback } from "./LiveFeedback";

export type TranscriptController = { prepareSubmission: () => Promise<void> };
type Props = {
  matchId: string;
  userId: string;
  audioStream: MediaStream | null;
  micEnabled: boolean;
  submitted: boolean;
  disabled: boolean;
  controllerRef: Ref<TranscriptController>;
  onContentChange: (ready: boolean) => void;
};
type Capture = { context: AudioContext; node: AudioWorkletNode; source: MediaStreamAudioSourceNode; silent: GainNode; flushed?: () => void };

export function LiveTranscript({ matchId, userId, audioStream, micEnabled, submitted, disabled, controllerRef, onContentChange }: Props) {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [draft, setDraft] = useState("");
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const [permanentError, setPermanentError] = useState(false);
  const [sendingText, setSendingText] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const mounted = useRef(false);
  const saved = useRef<TranscriptSegment[]>([]);
  const draftRef = useRef("");
  const outbox = useRef<PendingContribution[]>([]);
  const capture = useRef<Capture | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const draining = useRef<Promise<void> | null>(null);
  const stopping = useRef<Promise<void> | null>(null);
  const sending = useRef(false);
  const generation = useRef(0);
  const volatile = useRef(new Set<string>());
  const draftKey = `debate-draft:${matchId}:${userId}`;

  function notify() {
    if (mounted.current) onContentChange(!!(draftRef.current.trim() || outbox.current.length || capture.current || saved.current.some(segment => segment.userId === userId)));
  }

  function setText(text: string) {
    draftRef.current = text;
    setDraft(text);
    try { localStorage.setItem(draftKey, text); } catch {}
    notify();
  }

  async function loadTranscript() {
    const response = await authenticatedFetch(`/api/match/${matchId}/transcript`, { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to refresh the transcript.");
    if (!mounted.current) return;
    if (Array.isArray(data.segments) && data.segments.length >= saved.current.length) {
      saved.current = data.segments;
      setSegments(data.segments);
      notify();
    }
  }

  function drain(): Promise<void> {
    if (draining.current) return draining.current;
    const run = async () => {
      while (mounted.current && outbox.current.length && !submitted) {
        const contribution = outbox.current[0];
        try {
          const form = new FormData();
          form.append("segmentId", contribution.id);
          form.append("source", contribution.source);
          if (contribution.audio) form.append("audio", contribution.audio, "speech.wav");
          else form.append("text", contribution.text ?? "");
          const response = await authenticatedFetch(`/api/match/${matchId}/transcript`, {
            method: "POST", body: form, signal: AbortSignal.timeout(50000),
          });
          const data = await response.json();
          if (!response.ok) {
            if (mounted.current) setPermanentError([400, 409, 413].includes(response.status));
            throw new Error(data.error || "Unable to save this contribution.");
          }
          if (!volatile.current.has(contribution.key)) await removeContribution(contribution.key);
          volatile.current.delete(contribution.key);
          outbox.current = outbox.current.filter(entry => entry.key !== contribution.key);
          if (!mounted.current) return;
          if (data.segment && !saved.current.some(segment => segment.id === data.segment.id && segment.userId === data.segment.userId)) {
            saved.current = [...saved.current, data.segment];
            setSegments(saved.current);
          }
          setPending(outbox.current.length);
          setError(""); setPermanentError(false);
          notify();
        } catch (err) {
          if (mounted.current) setError(err instanceof Error ? err.message : "Connection lost. Unsaved contributions will retry from this browser.");
          return;
        }
      }
    };
    draining.current = run().finally(() => { draining.current = null; });
    return draining.current;
  }

  function enqueue(source: "speech" | "text", value: Blob | string) {
    const id = crypto.randomUUID();
    const entry: PendingContribution = {
      key: `${matchId}:${userId}:${id}`, id, matchId, userId, source, createdAt: Date.now(),
      ...(source === "speech" ? { audio: value as Blob } : { text: value as string }),
    };
    const write = writes.current.then(async () => {
      try { await persistContribution(entry); }
      catch {
        volatile.current.add(entry.key);
        if (mounted.current) setStorageWarning("Browser storage is unavailable. Keep this page open until your contributions finish saving.");
      }
      outbox.current.push(entry);
      if (mounted.current) { setPending(outbox.current.length); notify(); }
      if (outbox.current.length >= 30) {
        void stopRecording();
        if (mounted.current) setError("Transcription is paused while your saved clips catch up. You can retry saving them below.");
      }
    });
    writes.current = write.catch(err => {
      if (mounted.current) setError(err instanceof Error ? err.message : "Unable to preserve this contribution.");
      void stopRecording();
    });
    void write.then(() => drain()).catch(() => {});
    return write;
  }

  function stopRecording(): Promise<void> {
    if (stopping.current) return stopping.current;
    const active = capture.current;
    capture.current = null;
    if (mounted.current) { setRecording(false); setSpeaking(false); notify(); }
    if (!active) return Promise.resolve();
    stopping.current = (async () => {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 1000);
        active.flushed = () => { clearTimeout(timeout); resolve(); };
        active.node.port.postMessage("flush");
      });
      active.source.disconnect(); active.node.disconnect(); active.silent.disconnect();
      await active.context.close().catch(() => {});
    })().finally(() => { stopping.current = null; });
    return stopping.current;
  }

  async function startRecording() {
    if (!audioStream || starting || capture.current || disabled || submitted) return;
    setStarting(true); setError("");
    let context: AudioContext | null = null;
    try {
      if (!window.AudioContext || !window.AudioWorkletNode) throw new Error("Live speech capture is unavailable in this browser. You can add text below.");
      context = new AudioContext();
      await context.audioWorklet.addModule("/audio/transcript-processor.js");
      await context.resume();
      if (!mounted.current) { await context.close(); return; }
      const source = context.createMediaStreamSource(new MediaStream(audioStream.getAudioTracks()));
      const node = new AudioWorkletNode(context, "debate-transcript");
      const silent = context.createGain(); silent.gain.value = 0;
      const active: Capture = { context, node, source, silent };
      capture.current = active;
      node.port.onmessage = event => {
        if (event.data.type === "chunk") {
          const bytes = encodeWav(event.data.samples, active.context.sampleRate);
          void enqueue("speech", new Blob([bytes], { type: "audio/wav" })).catch(() => {});
        } else if (event.data.type === "flushed") active.flushed?.();
        else if (event.data.type === "level" && mounted.current) setSpeaking(event.data.speaking);
      };
      source.connect(node); node.connect(silent); silent.connect(context.destination);
      setRecording(true); notify();
    } catch (err) {
      await context?.close().catch(() => {});
      setError(err instanceof Error ? err.message : "Unable to start speech capture. You can add text below.");
    } finally {
      if (mounted.current) setStarting(false);
    }
  }

  async function sendText() {
    const text = draftRef.current.trim();
    if (!text || disabled || submitted || sending.current) return;
    sending.current = true; setSendingText(true);
    try { await enqueue("text", text); setText(""); } catch {}
    finally { sending.current = false; if (mounted.current) setSendingText(false); }
  }

  useImperativeHandle(controllerRef, () => ({
    async prepareSubmission() {
      await stopRecording();
      await writes.current;
      const text = draftRef.current.trim();
      if (text) { await enqueue("text", text); setText(""); }
      await writes.current;
      await drain();
      if (outbox.current.length) throw new Error("Some contributions are not saved yet. Keep this page open and retry before submitting.");
      await loadTranscript();
      if (!saved.current.some(segment => segment.userId === userId)) throw new Error("No speech was captured yet. Add a text contribution or start live transcription before submitting.");
    },
  }));

  useEffect(() => {
    mounted.current = true;
    const epoch = ++generation.current;
    let fetching = false;
    const initialize = async () => {
      try {
        let restored: PendingContribution[] = [];
        try { restored = await pendingContributions(matchId, userId); }
        catch { if (mounted.current) setStorageWarning("Browser storage is unavailable. Keep this page open until your contributions finish saving."); }
        if (!mounted.current || generation.current !== epoch) return;
        outbox.current = restored;
        setPending(outbox.current.length);
        try { const cached = localStorage.getItem(draftKey) ?? ""; draftRef.current = cached; setDraft(cached); } catch {}
        await loadTranscript();
        void drain();
      } catch (err) {
        if (mounted.current) setError(err instanceof Error ? err.message : "Unable to restore the transcript.");
      } finally {
        if (mounted.current) { setReady(true); notify(); }
      }
    };
    void initialize();
    const tick = async () => {
      if (!mounted.current || fetching) return;
      fetching = true;
      try { await loadTranscript(); await drain(); }
      catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Unable to refresh the transcript."); }
      finally { fetching = false; }
    };
    const timer = setInterval(tick, 2500);
    window.addEventListener("online", tick);
    return () => {
      mounted.current = false;
      clearInterval(timer); window.removeEventListener("online", tick);
      void stopRecording();
    };
    // A panel belongs to one immutable room/player. Mutable queues and audio
    // handles live in refs so rerenders never restart a capture or upload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, userId]);

  useEffect(() => {
    if (submitted) void stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  async function discardFirst() {
    if (draining.current) await draining.current;
    const entry = outbox.current[0];
    if (!entry) return;
    if (!volatile.current.has(entry.key)) await removeContribution(entry.key);
    volatile.current.delete(entry.key);
    outbox.current.shift(); setPending(outbox.current.length); setError(""); setPermanentError(false); notify();
    void drain();
  }

  return (
    <section aria-labelledby="live-transcript-title" className="mt-8 rounded-xl border p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="live-transcript-title" className="text-xl font-semibold">Live debate transcript</h2>
        <span role="status" className={`rounded-full px-3 py-1 text-xs font-medium ${recording ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"}`}>
          {recording ? !micEnabled ? "Microphone muted" : speaking ? "Hearing your voice" : "Listening..." : submitted ? "Transcript submitted" : "Transcription paused"}
        </span>
      </div>
      <p className="mt-2 text-sm text-gray-600">English speech appears after a short pause or about eight seconds. Only your microphone is captured. Headphones help keep the speakers separate.</p>
      <button type="button" disabled={!ready || disabled || submitted || starting || pending >= 30 || (!recording && (!audioStream || !micEnabled))} onClick={() => recording ? void stopRecording() : void startRecording()} className="mt-4 rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50">
        {starting ? "Starting..." : recording ? "Pause Transcription" : "Start Live Transcript"}
      </button>
      <p role="status" className="mt-3 text-sm text-gray-600">
        {!ready ? "Restoring transcript..." : pending ? `${pending} contribution${pending === 1 ? "" : "s"} ${storageWarning ? "waiting to upload. Keep this page open." : "saved in this browser, waiting to upload."}` : "All captured contributions are saved."}
      </p>
      {storageWarning && pending > 0 && <p role="alert" className="mt-2 text-sm text-amber-800">{storageWarning}</p>}
      {error && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
        <p role="alert">{error}</p>
        {pending > 0 && <button type="button" onClick={() => void drain()} className="mt-2 mr-4 underline">Retry Saving</button>}
        {permanentError && pending > 0 && <button type="button" onClick={() => void discardFirst()} className="mt-2 underline">Discard Unsaved Contribution</button>}
      </div>}
      <div role="log" aria-label="Saved debate transcript" aria-live="polite" className="mt-4 max-h-80 space-y-3 overflow-y-auto rounded-lg bg-gray-50 p-4">
        {segments.length ? segments.map(segment => <div key={`${segment.userId}:${segment.id}`} className="rounded-lg border bg-white p-3">
          <p className="text-xs font-semibold text-gray-500">{segment.username} · Side {segment.side}{segment.userId === userId ? " · You" : ""} · {segment.source === "speech" ? "Speech" : "Text"}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-900">{segment.text}</p>
        </div>) : <p className="text-sm text-gray-500">Saved speech and text from both speakers will appear here.</p>}
      </div>
      <label htmlFor="text-contribution" className="mt-5 block text-sm font-medium">Add a text contribution</label>
      <textarea id="text-contribution" value={draft} onChange={event => setText(event.target.value)} disabled={disabled || submitted || !ready} maxLength={2000} rows={3} placeholder="Type your argument if speech capture is unavailable..." className="mt-2 w-full rounded-lg border px-3 py-2 text-sm disabled:bg-gray-100" />
      <button type="button" disabled={disabled || submitted || sendingText || !draft.trim()} onClick={() => void sendText()} className="mt-2 rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50">{sendingText ? "Saving..." : "Send Text"}</button>
      <p className="mt-2 text-xs text-gray-500">Saved contributions form your debate evidence. Submit Debate freezes your contributions and sends the saved text to the judge once both players submit.</p>
      <LiveFeedback matchId={matchId} segments={segments} />
    </section>
  );
}
