// 对齐 upstream extensions/memory_defense.py（46 patterns）+ KOOK 自有 token。
const A_START = '(?<![A-Za-z0-9_])';
const A_END = '(?![A-Za-z0-9_])';
const tok = body => new RegExp(A_START + body + A_END);
const defs = [
  ['anthropic_key', tok('sk-ant-[A-Za-z0-9_-]{20,}')],
  ['openai_project_key', tok('sk-proj-[A-Za-z0-9_-]{48,}')],
  ['openai_admin_key', tok('sk-admin-[A-Za-z0-9_-]{40,}')],
  ['openai_key', tok('sk-[A-Za-z0-9_-]{20,}')],
  ['google_api_key', tok('AIza[0-9A-Za-z_-]{35}')],
  ['google_oauth_token', tok('ya29\\.[0-9A-Za-z_-]{20,}')],
  ['xai_key', tok('xai-[A-Za-z0-9]{40,}')],
  ['groq_key', tok('gsk_[A-Za-z0-9]{20,}')],
  ['hindsight_key', tok('hsk_(?:sys_)?[0-9a-f]{32}(?:_[0-9a-f]{8,})?')],
  ['huggingface_token', tok('hf_[A-Za-z0-9]{30,}')],
  ['replicate_token', tok('r8_[A-Za-z0-9]{30,}')],
  ['perplexity_key', tok('pplx-[A-Za-z0-9]{40,}')],
  ['databricks_token', tok('dapi[A-Za-z0-9]{32}')],
  ['aws_access_key', tok('AKIA[0-9A-Z]{16}')],
  ['aws_session_token', tok('ASIA[0-9A-Z]{16}')],
  ['aws_secret_key', /aws(.{0,20})?(secret|private)?[\s_-]?access[\s_-]?key[\s_-]?[:=][\s"']*([A-Za-z0-9/+=]{40})/i],
  ['digitalocean_token', tok('dop_v1_[a-f0-9]{64}')],
  ['github_fg_pat', tok('github_pat_[A-Za-z0-9_]{60,}')],
  ['github_token', tok('ghp_[A-Za-z0-9]{36}')],
  ['github_app_token', tok('ghs_[A-Za-z0-9]{36}')],
  ['github_user_token', tok('ghu_[A-Za-z0-9]{36}')],
  ['github_refresh', tok('ghr_[A-Za-z0-9]{36}')],
  ['github_oauth', tok('gho_[A-Za-z0-9]{36}')],
  ['gitlab_pat', tok('glpat-[A-Za-z0-9_-]{20,}')],
  ['npm_token', tok('npm_[A-Za-z0-9]{30,}')],
  ['pypi_token', tok('pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{20,}')],
  ['stripe_secret', tok('sk_(?:live|test)_[A-Za-z0-9]{20,}')],
  ['stripe_restricted', tok('rk_(?:live|test)_[A-Za-z0-9]{20,}')],
  ['square_token', tok('sq0[a-z]{3}-[A-Za-z0-9_-]{22,}')],
  ['braintree_token', tok('access_token\\$production\\$[a-z0-9]{16}\\$[a-f0-9]{32}')],
  ['slack_token', tok('xox[abpr]-[0-9A-Za-z-]{10,}')],
  ['slack_webhook', /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_]{8,}\/B[A-Za-z0-9_]{8,}\/[A-Za-z0-9_]{20,}/],
  ['twilio_api_key', tok('SK[0-9a-fA-F]{32}')],
  ['twilio_account_sid', tok('AC[0-9a-fA-F]{32}')],
  ['sendgrid_key', tok('SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}')],
  ['mailgun_key', tok('key-[A-Za-z0-9]{32}')],
  ['discord_bot', tok('[MNO][A-Za-z0-9]{23}\\.[A-Za-z0-9_-]{6}\\.[A-Za-z0-9_-]{27}')],
  ['telegram_bot', tok('[0-9]{8,10}:[A-Za-z0-9_-]{35}')],
  ['kook_bot_token', /\d\/[A-Za-z0-9+/]{4,}={0,2}\/[A-Za-z0-9+/]{20,}={0,2}/],
  ['shopify_token', tok('shpat_[a-fA-F0-9]{32}')],
  ['db_url_postgres', /postgres(?:ql)?:\/\/[^\s:/@]+:[^\s/@]+@[^\s]+/],
  ['db_url_mysql', /mysql:\/\/[^\s:/@]+:[^\s/@]+@[^\s]+/],
  ['db_url_mongodb', /mongodb(?:\+srv)?:\/\/[^\s:/@]+:[^\s/@]+@[^\s]+/],
  ['private_key_pem', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/],
  ['jwt', tok('eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}')],
  ['credit_card', tok('(?<!\\d)(?<!\\d\\.)(?:\\d{4}[ -]?){3}\\d{1,4}(?!\\d)(?!\\.\\d)')],
  ['ssn_us', tok('\\d{3}-\\d{2}-\\d{4}')],
].map(([name, re]) => ({ name, re }));

export const UPSTREAM_PATTERN_COUNT = 46;
export const SECRET_PATTERNS = defs;
const UUID_RE = /[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}/g;

export function fingerprint(value) {
  const s = String(value);
  if (s.length < 6) return '[redacted]';
  if (s.length <= 15) return `${s.slice(0, 2)}...${s.slice(-2)}`;
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

export function isLuhnCard(value) {
  const digits = [...String(value)].filter(c => /\d/.test(c)).map(Number);
  if (digits.length < 13 || new Set(digits).size === 1) return false;
  let sum = 0;
  [...digits].reverse().forEach((d, i) => {
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  });
  return sum % 10 === 0;
}

function globalRegex(re) { return new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`); }

export function redactSecrets(input) {
  let content = String(input);
  const matchedTypes = [];
  const hits = [];
  for (const { name, re } of defs) {
    if (name === 'credit_card') {
      const pattern = globalRegex(re);
      let searchStart = 0;
      let copiedUntil = 0;
      const parts = [];
      while (searchStart < content.length) {
        pattern.lastIndex = searchStart;
        const match = pattern.exec(content);
        if (!match) break;
        searchStart = match.index + 1;
        const value = match[0];
        if (!isLuhnCard(value)) continue;
        UUID_RE.lastIndex = 0;
        let uuidOverlap = false;
        let uuid;
        while ((uuid = UUID_RE.exec(content))) {
          if (uuid.index < match.index + value.length && uuid.index + uuid[0].length > match.index) { uuidOverlap = true; break; }
        }
        if (uuidOverlap) continue;
        if (!matchedTypes.includes(name)) matchedTypes.push(name);
        hits.push({ detector: name, preview: fingerprint(value) });
        parts.push(content.slice(copiedUntil, match.index), `[REDACTED:${name}]`);
        copiedUntil = match.index + value.length;
        searchStart = copiedUntil;
      }
      if (copiedUntil) content = parts.concat(content.slice(copiedUntil)).join('');
      continue;
    }
    const pattern = globalRegex(re);
    const matches = [...content.matchAll(pattern)];
    if (!matches.length) continue;
    if (!matchedTypes.includes(name)) matchedTypes.push(name);
    for (const match of matches) {
      const groups = match.slice(1).filter(Boolean);
      const raw = groups.length ? groups.sort((a, b) => b.length - a.length)[0] : match[0];
      if (raw) hits.push({ detector: name, preview: fingerprint(raw) });
    }
    content = content.replace(pattern, `[REDACTED:${name}]`);
  }
  return { text: content, matchedTypes, hits };
}

const INJECTION_RULES = [
  ['override_instructions', /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|忽略(?:以上|之前|先前|所有)指令/i],
  ['special_token', /<\|(?:im_start|im_end|system|assistant|user)\|>/i],
  ['secret_exfiltration', /(?:reveal|print|exfiltrate|dump).{0,40}(?:api[ _-]?key|secret|token|password)|(?:输出|泄露|打印).{0,20}(?:密钥|令牌|密码)/i],
  ['system_role_forge', /^\s*(?:system|开发者模式)\s*[:：]/im],
];
export function detectPromptInjection(input) {
  const text = String(input);
  return INJECTION_RULES.filter(([, re]) => re.test(text)).map(([name]) => ({ detector: `prompt_injection:${name}` }));
}

export class DefenseError extends Error {
  constructor(message, decision) {
    super(message);
    this.name = 'DefenseError';
    this.decision = decision;
  }
}

/** action: redact | block | allow；promptInjection 默认 off（这是本地附加检测，不冒充上游 cloud）。 */
export function applyDefense(input, { action = 'redact', promptInjection = 'off' } = {}) {
  if (action === false || action === 'off' || action === 'allow') {
    return { action: 'allow', text: String(input), hits: [], matchedTypes: [], promptInjectionHits: [] };
  }
  const promptInjectionHits = promptInjection === 'off' ? [] : detectPromptInjection(input);
  const result = redactSecrets(input);
  const blocked = action === 'block' && (result.hits.length || (promptInjection === 'block' && promptInjectionHits.length));
  const decision = { action: blocked ? 'block' : action, ...result, promptInjectionHits };
  if (blocked) throw new DefenseError(`Memory Defense 已拦截（${result.matchedTypes.concat(promptInjectionHits.map(h => h.detector)).join(', ')}）`, decision);
  return decision;
}

export function parseDefensePolicy(raw) {
  if (!raw) return { enabled: false, rules: [] };
  const rules = (raw.rules || []).map(rule => {
    if (!rule || typeof rule.on !== 'string' || !rule.on) throw new Error('Defense rule.on 必须是非空字符串');
    if (!['allow', 'redact', 'block'].includes(rule.action)) throw new Error(`未知 Defense action: ${rule.action}`);
    return { on: rule.on, action: rule.action };
  });
  return { enabled: Boolean(raw.enabled), rules };
}

export function screenWithPolicy(input, rawPolicy) {
  const policy = parseDefensePolicy(rawPolicy);
  if (!policy.enabled) return applyDefense(input, { action: 'allow' });
  const rule = policy.rules.find(r => r.on === 'sensitive_data') || { action: 'redact' };
  return applyDefense(input, { action: rule.action });
}
