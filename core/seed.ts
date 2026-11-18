/** First-run files of the app's deployment. */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRegion, endpointName, firstVendor, vendorEntry } from 'cortico-provider-coo/src/vendors.ts';
import { LANGUAGES, type Language } from 'cortico/core/language.ts';
import { readTextFile } from 'cortico/core/util.ts';
import { appLanguage } from './language.ts';
import { EARLIER_PERSONAS } from './seed-history.ts';

export const DEPLOYMENT = 'companion';
export const CONSOLE_PORT = 17788;
export const DISPLAY_NAME = '小小轩';
/** The provider module of the app's endpoints (cortico-provider-coo). */
const MODULE = 'coo';
/** The module the endpoints of versions up to 0.1.2 name; it became `coo`. */
const OLD_MODULE = 'deepseek';
/** When computer use asks first (`worlds.desktop-pet.cua.permission`): new installs get it written out, so a config without it is from before and keeps the default it had. */
const CUA_ASK = 'ask-once';
const OLD_CUA_ASK = 'ask-each-turn';

// ---- YHagent-Pet 预置端点 ----
/** 预置端点名（providers/ 目录与 config.activeProvider 用）。 */
const PRESET_NAME = 'yhagent';
/** 预置端点的密钥名：secretReader 在端点目录 .env / 进程环境里按名取值。 */
const PRESET_SECRET = 'YHAGENT_TOKEN';
/** 打包进 app 根的预置配置（scripts/pack.ts 生成；不存在 = 未预置的开发运行）。 */
interface Preset {
  /** YHagent 服务端 OpenAI 兼容门面基地址，如 https://yhagent.club/v1 或 http://<ip>:8080/v1。 */
  baseUrl: string;
  /** 内置访问码（= 服务端 SERVER_TOKEN），写入端点 .env，不进 git。 */
  token: string;
  /** 对外模型名（门面 /v1/models 返回值；客户端下拉显示用）。 */
  model: string;
  /** .env 密钥名（默认 YHAGENT_TOKEN，一般不用改）。 */
  secret?: string;
}

/** 读 <app root>/preset.json；缺失或字段不全时返回 null（走上游默认行为）。 */
function readPreset(): Preset | null {
  try {
    const file = fileURLToPath(new URL('../preset.json', import.meta.url));
    const parsed = JSON.parse(readTextFile(file)) as Partial<Preset>;
    if (!parsed.baseUrl || !parsed.token) return null;
    return { baseUrl: parsed.baseUrl, token: parsed.token, model: parsed.model || 'yhagent-delta', secret: parsed.secret || PRESET_SECRET };
  } catch {
    return null;
  }
}

/** 预置端点的 provider entry：coo 模块 + chat 协议 + 多模态（截图/pet_see_self 可用）。 */
function presetEntry(preset: Preset): Record<string, unknown> {
  return {
    kind: MODULE,
    baseUrl: preset.baseUrl,
    secret: preset.secret,
    spec: { model: preset.model, thinking: true, reasoningEffort: 'high', maxTokens: 8192 },
    multimodal: true,
    pricing: [],
    options: { protocol: 'chat' },
  };
}
const SEED_DIR = fileURLToPath(new URL('./seed/', import.meta.url));
/**
 * The self-descriptions Coo can start from, in the order the introduction offers them: Coo as it ships, four
 * after principles of Cultist Simulator, and the whale's (the GitHub build only). Each is in SEED_DIR/persona/
 * as `<id>.<language>.md`, one per app language.
 */
export const PERSONAS = ['coo', 'grail', 'forge', 'heart', 'winter', 'whale'] as const;
export type PersonaId = typeof PERSONAS[number];
/** The workspace file that holds Coo's self-description (Cormini's). */
const CONSTITUTION = 'CONSTITUTION.md';
export const personaFile = (id: PersonaId, language: Language) => join(SEED_DIR, 'persona', `${id}.${language}.md`);

/**
 * Writes the first-run files that are missing. A new deployment config gets `language` and an
 * endpoint without a key: the first model service listed for that language, on its platform for that
 * language (vendors.ts). Existing files are left as the operator made them, except a self-description
 * still exactly as a version seeded it, which becomes the same persona in the config's `language`
 * (`followLanguage`), endpoints of the old `deepseek` module, which now belong
 * to `coo`, a config of computer use as its own World (`worlds.cua`), whose section, whether it was on
 * included, moves to `worlds.desktop-pet.cua`, a config without a computer-use `permission`, which
 * keeps the `ask-each-turn` it had before new installs got `ask-once`, and the keys Cortico 0.2.0 renamed
 * (`moveTerminalToConsole`).
 *
 * YHagent-Pet 预置端点：`<app root>/preset.json`（scripts/pack.ts 从不入库的 .env.build 生成）存在时，
 * 新安装直接创建连到 YHagent 服务端 OpenAI 兼容门面的端点（内置访问码，protocol=chat，
 * multimodal 截图可用），引导第 5 步见模型已连接自动跳过——玩家装完即用。
 * preset.json 不存在时保持上游行为（选模型服务填 Key），便于无预置的开发运行。
 */
export function seed(home: string, language: Language): void {
  const deploy = join(home, DEPLOYMENT);
  const workspace = join(deploy, 'workspace');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(home, 'providers'), { recursive: true });
  const write = (file: string, value: unknown) => { if (!existsSync(file)) writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
  write(join(deploy, 'deployment.json'), { bot: 'cormini' });
  const config = join(deploy, 'config.json');
  const upgrading = existsSync(config);
  const preset = readPreset();
  if (!upgrading && preset) {
    // YHagent 预置端点：一次写全（端点条目 + 内置访问码 + 激活），首启引导不再问模型服务
    const endpoint = join(home, 'providers', PRESET_NAME);
    mkdirSync(endpoint, { recursive: true });
    writeFileSync(join(endpoint, 'config.json'), JSON.stringify(presetEntry(preset), null, 2) + '\n');
    writeFileSync(join(endpoint, '.env'), `${preset.secret}=${preset.token}\n`);
    write(config, {
      displayName: DISPLAY_NAME,
      language,
      activeProvider: PRESET_NAME,
      providerSchemaVersion: 3,
      web: { port: CONSOLE_PORT },
      worlds: { 'desktop-pet': { cua: { permission: CUA_ASK } } },
    });
  } else if (!upgrading) {
    const vendor = firstVendor(language), region = defaultRegion(language), endpoint = join(home, 'providers', endpointName(vendor, region));
    mkdirSync(endpoint, { recursive: true });
    write(join(endpoint, 'config.json'), vendorEntry(vendor, vendor.model, region));
    write(config, {
      displayName: DISPLAY_NAME,
      language,
      activeProvider: endpointName(vendor, region),
      providerSchemaVersion: 3,
      web: { port: CONSOLE_PORT },
      worlds: { 'desktop-pet': { cua: { permission: CUA_ASK } } },
    });
  }
  const configured = appLanguage((JSON.parse(readTextFile(config)) as { language?: unknown }).language);
  if (!existsSync(join(workspace, CONSTITUTION))) copyFileSync(personaFile('coo', configured), join(workspace, CONSTITUTION));
  // the console shows it as the bot's avatar
  if (!existsSync(join(deploy, 'avatar.png'))) copyFileSync(join(SEED_DIR, 'avatar.png'), join(deploy, 'avatar.png'));
  followLanguage(workspace, configured);
  moveEndpointsToCoo(join(home, 'providers'));
  if (upgrading) {
    moveCuaIntoPet(config);
    keepCuaAsking(config);
    moveTerminalToConsole(deploy, config);
  }
}

type Section = Record<string, unknown>;
type WorldSections = { worlds?: Record<string, Section | undefined> };

/**
 * Cortico 0.2.0 renamed the `terminal` World to `console` and `logging.console` to `logging.stdout`:
 * `worlds.terminal`, `logging.console` and the deployment's `worlds/terminal/` prompt override move to
 * the new names. A key or folder already at the new name stays as it is.
 */
function moveTerminalToConsole(deploy: string, file: string): void {
  const config = JSON.parse(readTextFile(file)) as WorldSections & { logging?: Section };
  let changed = false;
  const old = config.worlds?.terminal;
  if (config.worlds && old) {
    config.worlds.console = { ...old, ...config.worlds.console };
    delete config.worlds.terminal;
    changed = true;
  }
  const logging = config.logging;
  if (logging && 'console' in logging) {
    logging.stdout ??= logging.console;
    delete logging.console;
    changed = true;
  }
  if (changed) writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  const prompts = join(deploy, 'worlds', 'terminal');
  if (existsSync(prompts) && !existsSync(join(deploy, 'worlds', 'console'))) renameSync(prompts, join(deploy, 'worlds', 'console'));
}

/** `worlds.cua` becomes `worlds.desktop-pet.cua`; a key already there stays as it is. */
function moveCuaIntoPet(file: string): void {
  const config = JSON.parse(readTextFile(file)) as WorldSections;
  const old = config.worlds?.cua;
  if (!config.worlds || !old) return;
  const pet = config.worlds['desktop-pet'] ?? {};
  config.worlds['desktop-pet'] = { ...pet, cua: { ...old, ...pet.cua as Section | undefined } };
  delete config.worlds.cua;
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
}

function keepCuaAsking(file: string): void {
  const config = JSON.parse(readTextFile(file)) as WorldSections;
  const pet = config.worlds?.['desktop-pet'];
  const cua = pet?.cua as Section | undefined;
  if (cua?.permission !== undefined) return;
  config.worlds = { ...config.worlds, 'desktop-pet': { ...pet, cua: { ...cua, permission: OLD_CUA_ASK } } };
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
}

function moveEndpointsToCoo(providers: string): void {
  for (const dir of readdirSync(providers, { withFileTypes: true })) {
    const file = join(providers, dir.name, 'config.json');
    if (!dir.isDirectory() || !existsSync(file)) continue;
    const config = JSON.parse(readTextFile(file)) as { kind?: string };
    if (config.kind !== OLD_MODULE) continue;
    config.kind = MODULE;
    writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  }
}

/** SHA-256 of a file's text with line endings as LF; null when it is missing. */
const hashOf = (file: string) => (existsSync(file) ? createHash('sha256').update(readTextFile(file).replaceAll('\r\n', '\n')).digest('hex') : null);

/** Each shipped self-description by the SHA-256 of its text; computed on first use. */
let shipped: Map<string, PersonaId> | null = null;

/**
 * The persona whose shipped self-description the workspace's is, in any language, exactly; null for one
 * the person or Coo changed. Self-descriptions earlier versions shipped (seed-history.ts) count as theirs.
 */
export function personaOf(workspace: string): PersonaId | null {
  const hash = hashOf(join(workspace, CONSTITUTION));
  shipped ??= new Map(PERSONAS.flatMap((id) => LANGUAGES.map((l) => [hashOf(personaFile(id, l))!, id] as const)));
  return hash === null ? null : shipped.get(hash) ?? EARLIER_PERSONAS[hash] ?? null;
}

/** Puts persona `id` in `language` in place of the workspace's self-description; the bot reads it from its next prefix on. */
export function applyPersona(workspace: string, id: PersonaId, language: Language): void {
  copyFileSync(personaFile(id, language), join(workspace, CONSTITUTION));
}

/**
 * Puts the same persona in `language` in place of a self-description still exactly as a version shipped it;
 * one the person or Coo changed stays. The bot reads the new one from its next session on.
 */
export function followLanguage(workspace: string, language: Language): void {
  const id = personaOf(workspace);
  if (id && hashOf(join(workspace, CONSTITUTION)) !== hashOf(personaFile(id, language))) applyPersona(workspace, id, language);
}
