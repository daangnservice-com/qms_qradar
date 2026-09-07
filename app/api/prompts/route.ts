import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { canAccessAnyCallQuality } from "@/lib/adminEmails";
import {
  ensurePromptTables,
  listPromptVersions,
  getPromptVersion,
  getProductionPrompt,
  savePromptVersion,
  setProductionVersion,
  seedChecklistDraftEvalSet,
} from "@/lib/promptStore";
import { PROMPT_TEMPLATE_KEYS, PROMPT_VARS, type PromptTemplateKey } from "@/lib/promptDefaults";
import { parseOutputSchemaConfig } from "@/lib/outputSchema";
import { DEFAULT_OUTPUT_SCHEMA_CONFIG, parseAudioPipelineConfig, parseResultParseConfig } from "@/lib/promptTypes";
import { cached, cacheInvalidate, SERVER_CACHE_TTL } from "@/lib/serverCache";

export const runtime = "nodejs";
export const maxDuration = 60;

function isTemplateKey(v: unknown): v is PromptTemplateKey {
  return typeof v === "string" && (PROMPT_TEMPLATE_KEYS as readonly string[]).includes(v);
}

async function requireAccess() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!canAccessAnyCallQuality(email)) {
    return { error: NextResponse.json({ error: "권한이 없습니다" }, { status: 403 }) };
  }
  return { email: email! };
}

export async function GET(req: Request) {
  const gate = await requireAccess();
  if ("error" in gate) return gate.error;

  const url = new URL(req.url);
  try {
    if (url.searchParams.get("ensure") === "1") await ensurePromptTables();
    const doEnsure = url.searchParams.get("ensure") === "1";
    const versionId = url.searchParams.get("versionId");
    if (versionId) {
      const v = await getPromptVersion(versionId);
      if (!v) return NextResponse.json({ error: "버전 없음" }, { status: 404 });
      return NextResponse.json({ version: v });
    }
    const templateKey = url.searchParams.get("templateKey") ?? "call_eval_growth";
    if (!isTemplateKey(templateKey)) {
      return NextResponse.json({ error: "잘못된 templateKey" }, { status: 400 });
    }
    const [versions, production] = await cached(
      `prompts:${templateKey}`,
      SERVER_CACHE_TTL.promptVersions,
      () =>
        Promise.all([
          listPromptVersions(templateKey, { ensure: doEnsure }),
          getProductionPrompt(templateKey),
        ]),
    );
    return NextResponse.json({
      templateKeys: PROMPT_TEMPLATE_KEYS,
      vars: PROMPT_VARS,
      templateKey,
      versions,
      production: production.version,
      defaultOutputConfig: DEFAULT_OUTPUT_SCHEMA_CONFIG,
    });
  } catch (e) {
    console.error("[api/prompts]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireAccess();
  if ("error" in gate) return gate.error;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "save");

    if (action === "setProduction") {
      const templateKey = body.templateKey;
      const versionId = body.versionId;
      if (!isTemplateKey(templateKey) || typeof versionId !== "string") {
        return NextResponse.json({ error: "templateKey/versionId 필요" }, { status: 400 });
      }
      const version = await setProductionVersion({
        templateKey,
        versionId,
        changedBy: gate.email,
        note: String(body.note ?? ""),
        action: body.rollback ? "rollback" : "promote",
      });
      cacheInvalidate(`prompts:${templateKey}`);
      return NextResponse.json({ version });
    }

    if (action === "seedChecklistDraft") {
      const templateKey = isTemplateKey(body.templateKey) ? body.templateKey : "call_eval_growth";
      const version = await seedChecklistDraftEvalSet({
        templateKey,
        createdBy: gate.email,
        promote: body.promote !== false,
      });
      cacheInvalidate(`prompts:${templateKey}`);
      return NextResponse.json({ version });
    }

    const templateKey = body.templateKey;
    if (!isTemplateKey(templateKey)) {
      return NextResponse.json({ error: "잘못된 templateKey" }, { status: 400 });
    }
    const criterionBindings = Array.isArray(body.criterionBindings)
      ? (body.criterionBindings as unknown[])
          .map((x) => {
            const o = x as Record<string, unknown>;
            return {
              criterionId: Number(o.criterionId),
              promptId: String(o.promptId ?? ""),
              enabled: o.enabled !== false,
            };
          })
          .filter((b) => Number.isFinite(b.criterionId))
      : Array.isArray(body.selectedCriterionIds)
        ? (body.selectedCriterionIds as unknown[]).map(Number).filter(Number.isFinite).map((id) => ({
            criterionId: id,
            promptId: "",
            enabled: true,
          }))
        : [];
    const outputSchemaConfig = parseOutputSchemaConfig(body.outputSchemaConfig);
    const resultParseConfig = parseResultParseConfig(body.resultParseConfig);
    const audioPipelineConfig = parseAudioPipelineConfig(body.audioPipelineConfig);

    const version = await savePromptVersion({
      templateKey,
      versionNote: body.versionNote != null ? String(body.versionNote) : undefined,
      versionLabel: body.versionLabel != null ? String(body.versionLabel) : undefined,
      basePrompt: String(body.basePrompt ?? ""),
      checklistTemplate: String(body.checklistTemplate ?? ""),
      criterionBindings,
      outputSchemaConfig,
      resultParseConfig,
      audioPipelineConfig,
      useChecklist: Boolean(body.useChecklist),
      changeNote: String(body.changeNote ?? ""),
      createdBy: gate.email,
      promote: Boolean(body.promote),
    });
    cacheInvalidate(`prompts:${templateKey}`);
    return NextResponse.json({ version });
  } catch (e) {
    console.error("[api/prompts POST]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
