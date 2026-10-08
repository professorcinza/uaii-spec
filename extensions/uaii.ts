/**
 * UAII — Unified AI Accessibility Interface (reference implementation)
 * Spec: https://github.com/professorcinza/uaii-spec (SPEC.md v0.1.0-draft)
 *
 * Mapping (SPEC.md § → this extension):
 *   §3.1 Intent Object      → classify every assistant message at `message_end`
 *   §3.2 Renderer Contract  → text (native floor) · audio (TTS `say`) · plain-language (model rewrite)
 *   §3.3 User Profile       → ~/.config/uaii/profile.json (portable, user-owned)
 *   §3.4 Negotiation        → kind→renderer coverage map at session_start, shown by /uaii
 *   R2  no silent loss      → every unrenderable payload emits StructuredLoss (session entry + ring)
 *   R3  no required channel → all optional channels off: text floor remains fully functional
 *   R5  urgency preemption  → audio speaks only when intent urgency ≥ profile threshold
 *   R7  plain language      → plain-language renderer; declared loss when no model available
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------- §3.3 User Profile ----------

type Channel = "text" | "audio" | "plain-language";
type Urgency = "background" | "normal" | "alert" | "critical";

type Profile = {
	channels: { channel: Channel; enabled: boolean }[];
	urgencyThreshold: Urgency;
	constraints: { ttsMaxChars: number; plainMaxChars: number; plainMinChars: number };
};

const PROFILE_PATH = join(homedir(), ".config", "uaii", "profile.json");
const URGENT: Urgency[] = ["background", "normal", "alert", "critical"];
const DEFAULT_PROFILE: Profile = {
	channels: [
		{ channel: "text", enabled: true }, // R3: native floor, never disabled
		{ channel: "audio", enabled: false },
		{ channel: "plain-language", enabled: false },
	],
	urgencyThreshold: "normal",
	constraints: { ttsMaxChars: 400, plainMaxChars: 4000, plainMinChars: 120 },
};

function loadProfile(): Profile {
	try {
		const raw = JSON.parse(readFileSync(PROFILE_PATH, "utf8")) as Partial<Profile>;
		return { ...DEFAULT_PROFILE, ...raw, constraints: { ...DEFAULT_PROFILE.constraints, ...raw.constraints } };
	} catch {
		return structuredClone(DEFAULT_PROFILE);
	}
}

function saveProfile(profile: Profile): void {
	mkdirSync(join(homedir(), ".config", "uaii"), { recursive: true });
	writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2) + "\n");
}

const enabled = (profile: Profile, channel: Channel) =>
	profile.channels.find((c) => c.channel === channel)?.enabled === true;

// ---------- §3.1 Intent Object ----------

type IntentKind = "statement" | "question" | "action-request" | "media";
type Intent = { kind: IntentKind; urgency: Urgency; text: string };

const ACTION_STARTERS =
	/^(should|shall|could|can|would|do you want|want me|shall i|may i|let me|i'll|i will)\b/i;

function classify(text: string): Intent {
	const trimmed = text.trim();
	if (/![^\s]*\]\(|<img\s/i.test(trimmed)) return { kind: "media", urgency: "normal", text: trimmed };
	if (/\?\s*$/.test(trimmed) || /^(who|what|when|where|why|how|which|is|are|does|did)\b.*\?/im.test(trimmed))
		return { kind: "question", urgency: "alert", text: trimmed };
	if (ACTION_STARTERS.test(trimmed)) return { kind: "action-request", urgency: "alert", text: trimmed };
	return { kind: "statement", urgency: "normal", text: trimmed };
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((b): b is { type: "text"; text: string } => !!b && typeof b === "object" && (b as any).type === "text")
		.map((b) => b.text)
		.join("\n");
}

// ---------- §3.2 Renderer Contract + R2 StructuredLoss ----------

type StructuredLoss = { intentKind: IntentKind; channel: Channel; lost: string; reason: string };

/** Strip markdown to speakable prose; every strip is a declared loss (R2). */
function speakable(intent: Intent, maxChars: number, losses: StructuredLoss[]): string {
	let out = intent.text.replace(/```[\s\S]*?```/g, () => {
		losses.push({ intentKind: intent.kind, channel: "audio", lost: "code block", reason: "unmappable" });
		return " Code omitted. ";
	});
	out = out
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " Image link omitted. ")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/[#*_>`|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (out.length > maxChars) {
		losses.push({
			intentKind: intent.kind,
			channel: "audio",
			lost: `${out.length - maxChars} trailing characters`,
			reason: "bandwidth",
		});
		out = out.slice(0, maxChars) + "…";
	}
	return out;
}

// ---------- Extension ----------

export default function uaiiExtension(pi: ExtensionAPI) {
	let profile = loadProfile();
	const lossRing: StructuredLoss[] = [];
	let platformAudioOK = process.platform === "darwin";

	const recordLosses = (losses: StructuredLoss[]) => {
		if (losses.length === 0) return;
		lossRing.push(...losses);
		if (lossRing.length > 20) lossRing.splice(0, lossRing.length - 20);
		for (const loss of losses) {
			try {
				pi.appendEntry("uaii.structured_loss", loss); // R2: durable, never silent
			} catch {
				// Runtime stale (print-mode exit race): the loss stays in the ring. Never crash, never silent.
			}
		}
	};

	const coverageMap = () => {
		const kinds: IntentKind[] = ["statement", "question", "action-request", "media"];
		const audio = enabled(profile, "audio");
		const plain = enabled(profile, "plain-language");
		return kinds
			.map((kind) => {
				const chain = ["text"];
				if (audio) chain.push("audio");
				if (plain) chain.push("plain-language");
				chain.push("StructuredLoss"); // §3.4: every chain ends in declared loss, never absence
				return `${kind.padEnd(15)} → ${chain.join(" → ")}`;
			})
			.join("\n");
	};

	const renderAudio = async (intent: Intent) => {
		if (!platformAudioOK) return; // loss already declared once at session start
		if (URGENT.indexOf(intent.urgency) < URGENT.indexOf(profile.urgencyThreshold)) return; // R5
		const losses: StructuredLoss[] = [];
		const speech = speakable(intent, profile.constraints.ttsMaxChars, losses);
		recordLosses(losses);
		if (!speech.trim()) return;
		try {
			await pi.exec("say", [speech]); // fire-and-forget guarded by try; failure → declared loss
		} catch {
			platformAudioOK = false;
			recordLosses([{ intentKind: intent.kind, channel: "audio", lost: "entire utterance", reason: "channel-off" }]);
		}
	};

	const renderPlain = async (intent: Intent, ctx: ExtensionContext) => {
		if (intent.text.length < profile.constraints.plainMinChars) return;
		const model = ctx.model;
		const losses: StructuredLoss[] = [];
		if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) {
			recordLosses([{ intentKind: intent.kind, channel: "plain-language", lost: "entire rewrite", reason: "channel-off" }]);
			return;
		}
		const source =
			intent.text.length > profile.constraints.plainMaxChars
				? (recordLosses([
						{
							intentKind: intent.kind,
							channel: "plain-language",
							lost: `${intent.text.length - profile.constraints.plainMaxChars} characters`,
							reason: "bandwidth",
						},
					]),
					intent.text.slice(0, profile.constraints.plainMaxChars))
				: intent.text;
		try {
			const response = await ctx.modelRegistry.complete(
				model,
				{
					messages: [
						{
							role: "user" as const,
							timestamp: Date.now(),
							content: [
								{
									type: "text" as const,
									text: `Rewrite this assistant reply in plain language: short sentences, no jargon, keep every fact. Output only the rewrite.\n\n${source}`,
								},
							],
						},
					],
				},
				{ cacheRetention: "none" },
			);
			const rewrite = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();
			if (rewrite && ctx.hasUI) ctx.ui.notify(`UAII plain: ${rewrite}`, "info"); // R7
			else if (!rewrite)
				recordLosses([{ intentKind: intent.kind, channel: "plain-language", lost: "entire rewrite", reason: "unmappable" }]);
		} catch {
			recordLosses([{ intentKind: intent.kind, channel: "plain-language", lost: "entire rewrite", reason: "channel-off" }]);
		}
	};

	// ---------- §3.4 Negotiation + lifecycle ----------

	pi.on("session_start", async (_event, ctx) => {
		profile = loadProfile();
		if (!platformAudioOK)
			recordLosses([{ intentKind: "statement", channel: "audio", lost: "all speech", reason: "unmappable" }]);
		if (ctx.hasUI) ctx.ui.notify(`UAII ready · audio ${enabled(profile, "audio") ? "on" : "off"} · plain ${enabled(profile, "plain-language") ? "on" : "off"} · profile: ${PROFILE_PATH}`, "info");
	});

	// R1: every user-facing output is expressible as an Intent Object → classify and dispatch.
	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		const text = textOf(event.message.content);
		if (!text.trim()) return;
		const intent = classify(text);
		// Fire-and-forget renderers own their failures: a late rejection must never crash the runtime (R2: declared, not fatal).
		if (enabled(profile, "audio"))
			void renderAudio(intent).catch(() =>
				recordLosses([{ intentKind: intent.kind, channel: "audio", lost: "entire utterance", reason: "unmappable" }]),
			);
		if (enabled(profile, "plain-language"))
			void renderPlain(intent, ctx).catch(() =>
				recordLosses([{ intentKind: intent.kind, channel: "plain-language", lost: "entire rewrite", reason: "unmappable" }]),
			);
	});

	// ---------- Commands ----------

	pi.registerCommand("uaii", {
		description: "UAII accessibility: status · audio on|off · plain on|off · urgency <level> · loss",
		handler: async (args, ctx) => {
			const [sub, value] = args.trim().split(/\s+/);
			const respond = (msg: string) => {
				if (ctx.hasUI) ctx.ui.notify(msg, "info");
			};

			if (!sub || sub === "status") {
				respond(`UAII negotiation (§3.4)\n${coverageMap()}\nUrgency threshold: ${profile.urgencyThreshold}\nProfile: ${PROFILE_PATH}`);
				return;
			}
			if (sub === "loss") {
				respond(lossRing.length ? lossRing.map((l) => `[${l.channel}] ${l.lost} (${l.reason})`).join("\n") : "No declared loss. Nothing was silently dropped (R2).");
				return;
			}
			if (sub === "urgency" && URGENT.includes(value as Urgency)) {
				profile.urgencyThreshold = value as Urgency;
				saveProfile(profile);
				respond(`UAII urgency threshold: ${value} (R5)`);
				return;
			}
			if ((sub === "audio" || sub === "plain") && (value === "on" || value === "off" || value === undefined)) {
				const channel: Channel = sub === "audio" ? "audio" : "plain-language";
				const next = value ? value === "on" : !enabled(profile, channel);
				profile.channels = profile.channels.map((c) => (c.channel === channel ? { ...c, enabled: next } : c));
				saveProfile(profile);
				respond(`UAII ${channel} ${next ? "on" : "off"}\n${coverageMap()}`);
				return;
			}
			respond("Usage: /uaii [status|audio on|off|plain on|off|urgency background|normal|alert|critical|loss]");
		},
	});
}
