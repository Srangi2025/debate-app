"use client";

import { authenticatedFetch, getGuestSession } from "@/lib/guest-auth";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { TOPICS } from "@/lib/topics";

type Player = {
  userId: string;
  username: string;
};

type MatchResponse = {
  id: string;
  topics: string[];
  createdAt: number;
  status: string;
  player1: Player | null;
  player2: Player | null;
  submissionReceived?: boolean;
  submittedTranscript?: string;
};

type DebatePhase = {
  key: string;
  label: string;
  duration: number;
};

const PHASES: DebatePhase[] = [
  { key: "prep", label: "Prep Time", duration: 30 },
  { key: "opening-a", label: "Opening Statement - You", duration: 60 },
  { key: "opening-b", label: "Opening Statement - Opponent", duration: 60 },
  { key: "discussion", label: "Open Discussion", duration: 120 },
  { key: "closing-a", label: "Closing Statement - You", duration: 60 },
  { key: "closing-b", label: "Closing Statement - Opponent", duration: 60 },
];

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function MatchPage() {
  const params = useParams();
  const matchId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [userId, setUserId] = useState("");
  const [matchData, setMatchData] = useState<MatchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [ending, setEnding] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [mediaReady, setMediaReady] = useState(false);

  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "connecting" | "connected" | "disconnected" | "failed"
  >("idle");

  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);

  const [phaseIndex, setPhaseIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(PHASES[0].duration);
  const [isFinished, setIsFinished] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const processedCandidatesRef = useRef<Set<string>>(new Set());
  const startedWebRTCRef = useRef(false);

  const currentPhase = useMemo(() => PHASES[phaseIndex], [phaseIndex]);

  useEffect(() => {
    let active = true;
    getGuestSession().then((session) => {
      if (active) setUserId(session.user.id);
    }).catch((error) => {
      if (active) alert(error.message);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!matchId) return;

    async function fetchMatch() {
      try {
        const res = await authenticatedFetch(`/api/match/${matchId}`);

        if (!res.ok) {
          setLoading(false);
          return;
        }

        const data: MatchResponse = await res.json();
        setSubmitted(Boolean(data.submissionReceived));
        if (data.submittedTranscript) setTranscript(data.submittedTranscript);
        setMatchData(data);
      } catch (error) {
        console.error("Failed to fetch match:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchMatch();
  }, [matchId]);

  useEffect(() => {
    if (isFinished) return;

    const timer = setTimeout(() => {
      if (timeLeft > 1) {
        setTimeLeft((prev) => prev - 1);
      } else if (phaseIndex < PHASES.length - 1) {
        const nextIndex = phaseIndex + 1;
        setPhaseIndex(nextIndex);
        setTimeLeft(PHASES[nextIndex].duration);
      } else {
        setTimeLeft(0);
        setIsFinished(true);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [timeLeft, phaseIndex, isFinished]);

  useEffect(() => {
    let mounted = true;

    async function setupMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (!mounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStreamRef.current = stream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        setMediaReady(true);
      } catch (error) {
        console.error("Camera/Mic error:", error);
        alert("Please allow camera and microphone access.");
      }
    }

    setupMedia();

    return () => {
      mounted = false;

      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current?.getTracks().forEach((track) => track.stop());

      pcRef.current?.close();
      pcRef.current = null;
      startedWebRTCRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [loading, mediaReady]);

  function createPeerConnection(currentMatchId: string, myUserId: string) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    const remoteStream = new MediaStream();
    remoteStreamRef.current = remoteStream;

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }

    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log("WebRTC connectionState:", state);

      if (state === "connected") setConnectionStatus("connected");
      else if (state === "connecting") setConnectionStatus("connecting");
      else if (state === "disconnected") setConnectionStatus("disconnected");
      else if (state === "failed") setConnectionStatus("failed");
      else if (state === "new") setConnectionStatus("idle");
    };

    pc.oniceconnectionstatechange = () => {
      console.log("WebRTC iceConnectionState:", pc.iceConnectionState);
    };

    pc.onicecandidate = async (event) => {
      if (!event.candidate) return;

      try {
        await authenticatedFetch("/api/webrtc/candidate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            matchId: currentMatchId,
            senderUserId: myUserId,
            candidate: event.candidate,
          }),
        });
      } catch (error) {
        console.error("Failed to send ICE candidate:", error);
      }
    };

    return pc;
  }

  useEffect(() => {
    if (!matchData || !mediaReady || !userId) return;
    if (startedWebRTCRef.current) return;

    const otherUserId =
      matchData.player1?.userId === userId
        ? matchData.player2?.userId || ""
        : matchData.player1?.userId || "";

    if (!otherUserId || !localStreamRef.current) return;

    startedWebRTCRef.current = true;
    processedCandidatesRef.current = new Set();

    const currentMatchId = matchData.id;
    const isCaller = userId < otherUserId;

    let stopped = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function startWebRTC() {
      try {
        setConnectionStatus("connecting");

        if (isCaller) {
          await authenticatedFetch("/api/webrtc/reset", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ matchId: currentMatchId }),
          });
        }

        const pc = createPeerConnection(currentMatchId, userId);
        pcRef.current = pc;

        localStreamRef.current?.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current as MediaStream);
        });

        if (isCaller) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          await authenticatedFetch("/api/webrtc/offer", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              matchId: currentMatchId,
              senderUserId: userId,
              offer,
            }),
          });
        }

        interval = setInterval(async () => {
          if (stopped) return;

          try {
            const res = await authenticatedFetch(
              `/api/webrtc/poll?matchId=${encodeURIComponent(
                currentMatchId
              )}&otherUserId=${encodeURIComponent(otherUserId)}`
            );

            if (!res.ok) return;

            const data = await res.json();

            if (data.offer && !pc.currentRemoteDescription && !isCaller) {
              await pc.setRemoteDescription(
                new RTCSessionDescription(data.offer)
              );

              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);

              await authenticatedFetch("/api/webrtc/answer", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  matchId: currentMatchId,
                  senderUserId: userId,
                  answer,
                }),
              });
            }

            if (data.answer && !pc.currentRemoteDescription && isCaller) {
              await pc.setRemoteDescription(
                new RTCSessionDescription(data.answer)
              );
            }

            for (const candidate of data.candidates || []) {
              const key = JSON.stringify(candidate);
              if (processedCandidatesRef.current.has(key)) continue;

              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                processedCandidatesRef.current.add(key);
              } catch (error) {
                console.error("ICE candidate error:", error);
              }
            }
          } catch (error) {
            console.error("Polling/signaling error:", error);
          }
        }, 1500);
      } catch (error) {
        console.error("WebRTC startup error:", error);
        setConnectionStatus("failed");
      }
    }

    startWebRTC();

    return () => {
      stopped = true;

      if (interval) clearInterval(interval);

      pcRef.current?.close();
      pcRef.current = null;
      startedWebRTCRef.current = false;
      setConnectionStatus("disconnected");
    };
  }, [matchData, mediaReady, userId]);

  useEffect(() => {
    if (!matchData || ending) return;

    const interval = setInterval(async () => {
      try {
        const res = await authenticatedFetch(`/api/match/${matchData.id}`);
        if (!res.ok) return;

        const data = await res.json();

        if (data.submissionReceived) {
          setSubmitted(true);
          if (data.submittedTranscript) setTranscript(data.submittedTranscript);
          setSubmissionError("");
        }

        if (data.status === "ended") {
          window.location.href = `/result/${matchData.id}`;
        }
      } catch (error) {
        console.error("Match status poll error:", error);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [matchData, ending]);

  function toggleMic() {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !track.enabled;
      setMicEnabled(track.enabled);
    });
  }

  function toggleCamera() {
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !track.enabled;
      setCameraEnabled(track.enabled);
    });
  }

  async function handleSubmitDebate() {
    if (submitted || ending) return;
    if (!matchData?.id) {
      alert("Match not loaded yet. Try again.");
      return;
    }

    if (!userId) {
      alert("Missing user ID. Go back to dashboard and join again.");
      return;
    }

    if (!transcript.trim()) {
      alert("Please enter your debate transcript.");
      return;
    }

    try {
      setEnding(true);
      setSubmissionError("");

      const res = await authenticatedFetch("/api/match/end", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          matchId: matchData.id,
          transcript,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSubmissionError(data.error || "Failed to submit the debate. Please try again.");
        setEnding(false);
        return;
      }

      if (
        data?.resultUrl &&
        (data.status === "completed" || data.alreadyCompleted)
      ) {
        window.location.href = data.resultUrl;
        return;
      }

      if (data.status === "waiting") {
        setSubmitted(true);
        setEnding(false);
        return;
      }

      setEnding(false);
    } catch (error) {
      console.error("Submit debate error:", error);
      setEnding(false);
      setSubmissionError("Unable to submit the debate. Check your connection and try again.");
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-white px-6 py-10 text-black">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-3xl font-bold">Loading match...</h1>
        </div>
      </main>
    );
  }

  if (!matchData) {
    return (
      <main className="min-h-screen bg-white px-6 py-10 text-black">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-3xl font-bold">Match not found</h1>
          <Link
            href="/dashboard"
            className="mt-6 inline-block rounded-lg border px-6 py-3"
          >
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  const isPlayer1 = userId === matchData.player1?.userId;

  const yourUsername = isPlayer1
    ? matchData.player1?.username || "You"
    : matchData.player2?.username || "You";

  const opponentUsername = isPlayer1
    ? matchData.player2?.username || "Opponent"
    : matchData.player1?.username || "Opponent";

  const topicTitles =
    matchData.topics?.map((topicId) => {
      const found = TOPICS.find((topic) => topic.id === topicId);
      return found?.title ?? topicId;
    }) || [];

  const totalSeconds = PHASES.reduce((sum, phase) => sum + phase.duration, 0);

  const elapsedSeconds =
    PHASES.slice(0, phaseIndex).reduce(
      (sum, phase) => sum + phase.duration,
      0
    ) + (currentPhase.duration - timeLeft);

  const progress = Math.min((elapsedSeconds / totalSeconds) * 100, 100);

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-black">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-wide text-gray-500">
              Match ID
            </p>
            <h1 className="break-all text-3xl font-bold">{matchData.id}</h1>
          </div>

          <span className="rounded-full border px-4 py-2 text-sm font-medium">
            Ranked Match
          </span>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border p-6 lg:col-span-2">
            <p className="text-sm uppercase tracking-wide text-gray-500">
              Topics
            </p>

            <div className="mt-2 flex flex-wrap gap-2">
              {topicTitles.map((title) => (
                <span
                  key={title}
                  className="rounded-full border px-3 py-1 text-sm"
                >
                  {title}
                </span>
              ))}
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-gray-100 p-4">
                <p className="text-sm text-gray-500">You</p>
                <p className="mt-1 text-xl font-semibold">{yourUsername}</p>
              </div>

              <div className="rounded-xl bg-gray-100 p-4">
                <p className="text-sm text-gray-500">Opponent</p>
                <p className="mt-1 text-xl font-semibold">
                  {opponentUsername}
                </p>
              </div>
            </div>

            <div className="mt-8">
              <div className="mb-2 flex items-center justify-between text-sm text-gray-600">
                <span>Match Progress</span>
                <span>{Math.round(progress)}%</span>
              </div>

              <div className="h-3 w-full rounded-full bg-gray-200">
                <div
                  className="h-3 rounded-full bg-black transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="mt-8 rounded-2xl bg-black p-8 text-center text-white">
              <p className="text-sm uppercase tracking-wide opacity-70">
                Current Phase
              </p>
              <p className="mt-3 text-2xl font-semibold">
                {isFinished ? "Debate Complete" : currentPhase.label}
              </p>
              <p className="mt-4 text-6xl font-bold">
                {isFinished ? "0:00" : formatTime(timeLeft)}
              </p>
            </div>

            <div className="mt-6 rounded-xl border p-4">
              <p className="text-sm uppercase tracking-wide text-gray-500">
                Call Status
              </p>
              <p className="mt-2 text-lg font-semibold">
                {connectionStatus === "idle" && "Idle"}
                {connectionStatus === "connecting" && "Connecting..."}
                {connectionStatus === "connected" && "Connected"}
                {connectionStatus === "disconnected" && "Disconnected"}
                {connectionStatus === "failed" && "Connection Failed"}
              </p>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border p-4">
                <p className="mb-3 text-sm uppercase tracking-wide text-gray-500">
                  Your Camera
                </p>
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="aspect-video w-full rounded-lg bg-black"
                />
              </div>

              <div className="rounded-xl border p-4">
                <p className="mb-3 text-sm uppercase tracking-wide text-gray-500">
                  Opponent Camera
                </p>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="aspect-video w-full rounded-lg bg-black"
                />
              </div>
            </div>

            <div className="mt-4 flex gap-3">
              <button
                onClick={toggleMic}
                className="rounded-lg border px-4 py-2 text-black"
              >
                {micEnabled ? "Mute Mic" : "Unmute Mic"}
              </button>

              <button
                onClick={toggleCamera}
                className="rounded-lg border px-4 py-2 text-black"
              >
                {cameraEnabled ? "Turn Camera Off" : "Turn Camera On"}
              </button>
            </div>

            <div className="mt-8 rounded-xl border p-6">
              <p className="text-sm uppercase tracking-wide text-gray-500">
                Debate Transcript / Summary
              </p>

              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                disabled={submitted || ending}
                maxLength={20000}
                placeholder="Paste or write your side of the debate here..."
                className="mt-3 h-40 w-full rounded-xl border px-4 py-3 outline-none focus:border-black disabled:bg-gray-100"
              />
              <p className="mt-2 text-sm text-gray-600">
                {submitted ? "Your response is saved." : "Review your response before submitting. Your first submission is final."}
              </p>
            </div>

            {submitted && (
              <p role="status" className="mt-4 rounded-xl border bg-gray-50 p-4">
                Debate submitted. Waiting for your opponent. The result will open automatically when both responses are in.
              </p>
            )}
            {submissionError && (
              <p role="alert" className="mt-4 text-red-700">{submissionError}</p>
            )}

            <div className="mt-8 flex flex-wrap gap-4">
              <button
                onClick={handleSubmitDebate}
                disabled={submitted || ending || !transcript.trim() || !matchData}
                className="rounded-lg bg-black px-6 py-3 text-white disabled:opacity-50"
              >
                {submitted ? "Submitted" : ending ? "Submitting..." : "Submit Debate"}
              </button>

              <Link
                href="/dashboard"
                className="rounded-lg border px-6 py-3 text-black"
              >
                Leave Match
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border p-6">
            <p className="text-sm uppercase tracking-wide text-gray-500">
              Debate Format
            </p>

            <div className="mt-4 space-y-3">
              {PHASES.map((phase, index) => {
                const active = index === phaseIndex && !isFinished;
                const done = index < phaseIndex || isFinished;

                return (
                  <div
                    key={phase.key}
                    className={`rounded-xl border p-4 ${
                      active
                        ? "border-black bg-black text-white"
                        : done
                        ? "border-gray-300 bg-gray-100 text-gray-500"
                        : "border-gray-200 bg-white"
                    }`}
                  >
                    <p className="font-medium">{phase.label}</p>
                    <p className="mt-1 text-sm opacity-80">
                      {formatTime(phase.duration)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
